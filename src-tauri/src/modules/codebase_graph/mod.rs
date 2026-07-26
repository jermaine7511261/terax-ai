use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct SymbolEntry {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub parent: Option<String>,
    pub references: Vec<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct FileGraph {
    pub path: String,
    pub symbols: Vec<SymbolEntry>,
    pub imports: Vec<String>,
    pub imported_by: Vec<String>,
    pub last_indexed: String,
}

pub struct CodebaseGraph {
    files: Mutex<HashMap<String, FileGraph>>,
    index_dir: Mutex<Option<PathBuf>>,
}

impl Default for CodebaseGraph {
    fn default() -> Self {
        Self { files: Mutex::new(HashMap::new()), index_dir: Mutex::new(None) }
    }
}

impl CodebaseGraph {
    pub fn new() -> Self { Self::default() }

    pub fn init(&self, dir: &std::path::Path) {
        *self.index_dir.lock().unwrap() = Some(dir.join(".terax-index"));
    }

    fn ts() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string()
    }

    fn extract_symbols(content: &str, file: &str) -> Vec<SymbolEntry> {
        let mut symbols = Vec::new();
        let mut id_counter = 0u32;

        for (line_idx, line) in content.lines().enumerate() {
            let line_num = line_idx as u32 + 1;

            // Rust: fn name(, struct Name, enum Name, impl Name
            if let Some(caps) = try_extract(line, &["fn ", "struct ", "enum ", "trait ", "impl ", "mod ", "type ", "const ", "macro_rules! "]) {
                symbols.push(SymbolEntry {
                    id: format!("sym-{}-{}", file.replace('/', "_"), { id_counter += 1; id_counter }),
                    name: caps.1.to_string(),
                    kind: caps.0.to_string(),
                    file: file.into(),
                    line: line_num,
                    column: (line.find(caps.0.as_str()).unwrap_or(0) + caps.0.len()) as u32,
                    parent: None,
                    references: Vec::new(),
                });
            }
            // TypeScript/JS: function name, class Name, interface Name, type Name, const name =, let name, var name
            if let Some(caps) = try_extract(line, &["function ", "class ", "interface ", "type ", "enum ", "abstract class "]) {
                symbols.push(SymbolEntry {
                    id: format!("sym-{}-{}", file.replace('/', "_"), { id_counter += 1; id_counter }),
                    name: caps.1.to_string(),
                    kind: caps.0.to_string(),
                    file: file.into(),
                    line: line_num,
                    column: (line.find(caps.0.as_str()).unwrap_or(0) + caps.0.len()) as u32,
                    parent: None,
                    references: Vec::new(),
                });
            }
            // Python: def name, class Name
            if let Some(caps) = try_extract(line, &["def ", "class ", "async def "]) {
                symbols.push(SymbolEntry {
                    id: format!("sym-{}-{}", file.replace('/', "_"), { id_counter += 1; id_counter }),
                    name: caps.1.to_string(),
                    kind: caps.0.to_string(),
                    file: file.into(),
                    line: line_num,
                    column: (line.find(caps.0.as_str()).unwrap_or(0) + caps.0.len()) as u32,
                    parent: None,
                    references: Vec::new(),
                });
            }
            // Go: func Name, type Name struct, type Name interface
            if let Some(caps) = try_extract(line, &["func ", "type ", "struct ", "interface "]) {
                symbols.push(SymbolEntry {
                    id: format!("sym-{}-{}", file.replace('/', "_"), { id_counter += 1; id_counter }),
                    name: caps.1.to_string(),
                    kind: caps.0.to_string(),
                    file: file.into(),
                    line: line_num,
                    column: (line.find(caps.0.as_str()).unwrap_or(0) + caps.0.len()) as u32,
                    parent: None,
                    references: Vec::new(),
                });
            }
        }
        symbols
    }

    fn extract_imports(content: &str) -> Vec<String> {
        let mut imports = Vec::new();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("import ") || trimmed.starts_with("use ") || trimmed.starts_with("from ") {
                let clean = trimmed.trim_end_matches(';').trim().to_string();
                if !imports.contains(&clean) { imports.push(clean); }
            }
            if trimmed.starts_with("#include") {
                imports.push(trimmed.to_string());
            }
            if trimmed.starts_with("require(") || trimmed.starts_with("from '") || trimmed.starts_with("from \"") {
                imports.push(trimmed.to_string());
            }
        }
        imports
    }

    pub fn index_file(&self, file: &str, content: &str) -> Result<FileGraph, String> {
        let symbols = Self::extract_symbols(content, file);
        let imports = Self::extract_imports(content);
        let now = Self::ts();

        let graph = FileGraph {
            path: file.into(),
            symbols,
            imports,
            imported_by: Vec::new(),
            last_indexed: now,
        };

        let mut files = self.files.lock().map_err(|e| e.to_string())?;
        let result = graph.clone();
        files.insert(file.into(), graph);

        // Update imported_by on referenced files
        for imp in &result.imports {
            for (path, fg) in files.iter_mut() {
                if imp.contains(path) || path.contains(imp.trim_matches('"').trim_matches('\'')) {
                    if !fg.imported_by.contains(&result.path) {
                        fg.imported_by.push(result.path.clone());
                    }
                }
            }
        }

        Ok(result)
    }

    pub fn remove_file(&self, file: &str) -> Result<(), String> {
        let mut files = self.files.lock().map_err(|e| e.to_string())?;
        files.remove(file);
        for fg in files.values_mut() {
            fg.imported_by.retain(|i| i != file);
        }
        Ok(())
    }

    pub fn search_symbol(&self, query: &str) -> Result<Vec<SymbolEntry>, String> {
        let files = self.files.lock().map_err(|e| e.to_string())?;
        let q = query.to_lowercase();
        let mut results = Vec::new();
        for fg in files.values() {
            for sym in &fg.symbols {
                if sym.name.to_lowercase().contains(&q) {
                    results.push(sym.clone());
                }
            }
        }
        results.sort_by(|a, b| a.name.cmp(&b.name));
        results.truncate(50);
        Ok(results)
    }

    pub fn find_references(&self, name: &str) -> Result<Vec<SymbolEntry>, String> {
        let files = self.files.lock().map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for fg in files.values() {
            for sym in &fg.symbols {
                if sym.name == name || sym.references.contains(&name.to_string()) {
                    results.push(sym.clone());
                }
            }
        }
        Ok(results)
    }

    pub fn get_file_graph(&self, file: &str) -> Result<Option<FileGraph>, String> {
        Ok(self.files.lock().map_err(|e| e.to_string())?.get(file).cloned())
    }

    pub fn get_all_symbols(&self) -> Result<Vec<SymbolEntry>, String> {
        let files = self.files.lock().map_err(|e| e.to_string())?;
        let mut all = Vec::new();
        for fg in files.values() {
            all.extend(fg.symbols.clone());
        }
        all.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
        Ok(all)
    }

    pub fn stats(&self) -> Result<(usize, usize, usize), String> {
        let files = self.files.lock().map_err(|e| e.to_string())?;
        let file_count = files.len();
        let symbol_count: usize = files.values().map(|f| f.symbols.len()).sum();
        let import_count: usize = files.values().map(|f| f.imports.len()).sum();
        Ok((file_count, symbol_count, import_count))
    }
}

fn try_extract<'a>(line: &'a str, keywords: &[&str]) -> Option<(String, &'a str)> {
    let trimmed = line.trim();
    for kw in keywords {
        if let Some(rest) = trimmed.strip_prefix(kw) {
            let name = rest.split(|c: char| c.is_whitespace() || c == '(' || c == '{' || c == ':')
                .next().unwrap_or("").trim();
            if !name.is_empty() && !name.starts_with('(') {
                return Some((kw.to_string(), name));
            }
        }
    }
    None
}

#[tauri::command]
pub fn cg_index(engine: tauri::State<'_, CodebaseGraph>, file: String, content: String) -> Result<FileGraph, String> {
    engine.index_file(&file, &content)
}

#[tauri::command]
pub fn cg_remove(engine: tauri::State<'_, CodebaseGraph>, file: String) -> Result<(), String> {
    engine.remove_file(&file)
}

#[tauri::command]
pub fn cg_search(engine: tauri::State<'_, CodebaseGraph>, query: String) -> Result<Vec<SymbolEntry>, String> {
    engine.search_symbol(&query)
}

#[tauri::command]
pub fn cg_references(engine: tauri::State<'_, CodebaseGraph>, name: String) -> Result<Vec<SymbolEntry>, String> {
    engine.find_references(&name)
}

#[tauri::command]
pub fn cg_file(engine: tauri::State<'_, CodebaseGraph>, file: String) -> Result<Option<FileGraph>, String> {
    engine.get_file_graph(&file)
}

#[tauri::command]
pub fn cg_all(engine: tauri::State<'_, CodebaseGraph>) -> Result<Vec<SymbolEntry>, String> {
    engine.get_all_symbols()
}

#[tauri::command]
pub fn cg_stats(engine: tauri::State<'_, CodebaseGraph>) -> Result<(usize, usize, usize), String> {
    engine.stats()
}

