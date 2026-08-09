//! Output-schema validation for subagent structured results (P2). Mirrors
//!  `schema_contract.rs` (compile + validate, no external `$ref`, size cap)
//! and omp `yield-assembly.ts` (`outputSchema` check). Uses `serde_json` to
//! enforce the schema shape — no new dependency.

use serde_json::Value;

/// Size cap on a compiled schema / payload (: 256 KB) so a hostile graph
/// def can't blow memory validating.
pub const MAX_SCHEMA_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaError {
    MissingField(String),
    TypeMismatch { path: String, expected: String },
    TooLarge,
    RefNotAllowed,
}

#[derive(Debug, Clone)]
pub struct OutputSchema(pub Value);

impl OutputSchema {
    /// Compile a JSON schema. Rejects external `$ref` (no `#/...` lookup
    /// escape into arbitrary files) and oversized schemas.
    pub fn compile(raw: &Value) -> Result<Self, SchemaError> {
        if serde_json::to_vec(raw).map(|b| b.len()).unwrap_or(usize::MAX) > MAX_SCHEMA_BYTES {
            return Err(SchemaError::TooLarge);
        }
        if schema_contains_external_ref(raw) {
            return Err(SchemaError::RefNotAllowed);
        }
        Ok(Self(raw.clone()))
    }

    /// Validate a payload against this schema. Returns the first error.
    pub fn validate(&self, payload: &Value) -> Result<(), SchemaError> {
        validate_against(&self.0, payload, "")
    }
}

fn schema_contains_external_ref(schema: &Value) -> bool {
    match schema {
        Value::Object(map) => map
            .iter()
            .any(|(k, v)| {
                (k == "$ref" && v.as_str().map(|s| !s.starts_with("#/")).unwrap_or(true))
                    || schema_contains_external_ref(v)
            }),
        Value::Array(arr) => arr.iter().any(schema_contains_external_ref),
        _ => false,
    }
}

fn validate_against(schema: &Value, payload: &Value, path: &str) -> Result<(), SchemaError> {
    let Some(obj) = schema.as_object() else {
        return Ok(()); // non-object schema (true / free-form) — accept
    };
    if obj.get("type").and_then(Value::as_str) == Some("null") {
        return Ok(());
    }
    // enum
    if let Some(enums) = obj.get("enum").and_then(Value::as_array) {
        if !enums.contains(payload) {
            return Err(SchemaError::TypeMismatch {
                path: path.to_string(),
                expected: format!("one of {enums:?}"),
            });
        }
    }
    // required + properties (objects)
    if let Some(required) = obj.get("required").and_then(Value::as_array) {
        for req in required {
            let Some(name) = req.as_str() else { continue };
            let p = if path.is_empty() { name.to_string() } else { format!("{path}.{name}") };
            if payload.get(name).is_none() {
                return Err(SchemaError::MissingField(p));
            }
        }
    }
    if let Some(props) = obj.get("properties").and_then(Value::as_object) {
        if let Value::Object(payload_obj) = payload {
            for (name, subschema) in props {
                if let Some(v) = payload_obj.get(name) {
                    let p = if path.is_empty() { name.clone() } else { format!("{path}.{name}") };
                    validate_against(subschema, v, &p)?;
                }
            }
        }
    }
    // type checks
    if let Some(typ) = obj.get("type").and_then(Value::as_str) {
        check_type(typ, payload, path)?;
    }
    Ok(())
}

fn check_type(typ: &str, payload: &Value, path: &str) -> Result<(), SchemaError> {
    let ok = match typ {
        "string" => payload.is_string(),
        "number" => payload.is_number(),
        "integer" => payload.as_i64().is_some() || payload.as_u64().is_some(),
        "boolean" => payload.is_boolean(),
        "array" => payload.is_array(),
        "object" => payload.is_object(),
        "null" => payload.is_null(),
        _ => true, // unknown type keyword — don't hard-fail
    };
    if ok {
        Ok(())
    } else {
        Err(SchemaError::TypeMismatch {
            path: path.to_string(),
            expected: typ.to_string(),
        })
    }
}

/// Validate a subagent result is a well-formed object with a `summary` string
/// (the structured single-exit contract). Mirrors the frontend summary check.
pub fn require_summary(payload: &Value) -> Result<String, SchemaError> {
    let obj = payload.as_object().ok_or(SchemaError::TypeMismatch {
        path: ".".to_string(),
        expected: "object".to_string(),
    })?;
    obj.get("summary")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or(SchemaError::MissingField("summary".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compiles_valid_schema() {
        let s = json!({"type":"object","required":["summary"],"properties":{"summary":{"type":"string"}}});
        assert!(OutputSchema::compile(&s).is_ok());
    }

    #[test]
    fn rejects_external_ref() {
        let s = json!({"$ref": "file:///etc/passwd"});
        assert!(matches!(OutputSchema::compile(&s), Err(SchemaError::RefNotAllowed)));
    }

    #[test]
    fn allows_internal_ref() {
        let s = json!({"$ref": "#/definitions/x"});
        assert!(OutputSchema::compile(&s).is_ok());
    }

    #[test]
    fn validates_missing_required() {
        let schema = OutputSchema::compile(&json!({"type":"object","required":["summary"]})).unwrap();
        assert_eq!(
            schema.validate(&json!({"done": true})),
            Err(SchemaError::MissingField("summary".to_string()))
        );
    }

    #[test]
    fn validates_type_mismatch() {
        let schema = OutputSchema::compile(&json!({
            "type":"object","required":["summary"],
            "properties":{"summary":{"type":"string"}}
        }))
        .unwrap();
        assert_eq!(
            schema.validate(&json!({"summary": 42})),
            Err(SchemaError::TypeMismatch { path: "summary".to_string(), expected: "string".to_string() })
        );
    }

    #[test]
    fn accepts_conforming_payload() {
        let schema = OutputSchema::compile(&json!({
            "type":"object","required":["summary"],
            "properties":{"summary":{"type":"string"}}
        }))
        .unwrap();
        assert!(schema.validate(&json!({"summary": "done"})).is_ok());
    }

    #[test]
    fn require_summary_extracts_string() {
        assert_eq!(require_summary(&json!({"summary": "ok"})).unwrap(), "ok");
        assert!(require_summary(&json!({})).is_err());
        assert!(require_summary(&json!([1, 2])).is_err());
    }
}
