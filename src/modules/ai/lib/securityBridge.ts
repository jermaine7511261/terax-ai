import { check, type PermissionRuleset, type PermissionEffect } from "./permissions";
import { checkReadable, checkWritable } from "./security";
import { canRead, canWrite, canNetwork } from "@/modules/sandbox/lib/sandboxApi";

export type SecurityCheckResult = {
  allowed: boolean;
  effect: PermissionEffect;
  reasons: string[];
};

/**
 * Unified security check across all three layers:
 * 1. Path security (secret file detection)
 * 2. Agent permissions (allow/ask/deny)
 * 3. Sandbox (workspace restriction)
 */
export async function checkSecurity(
  action: string,
  resource: string,
  rulesets: PermissionRuleset[],
): Promise<SecurityCheckResult> {
  const reasons: string[] = [];

  // Layer 1: Sandbox check (fastest, check first)
  try {
    if (action === "read" || action === "edit" || action === "write" || action === "delete") {
      const allowed = action === "read"
        ? await canRead(resource)
        : await canWrite(resource);
      if (!allowed) {
        return {
          allowed: false,
          effect: "deny",
          reasons: [`Sandbox: ${action} not allowed on "${resource}"`],
        };
      }
    }
    if (action === "bash" || action === "web_search" || action === "web_fetch") {
      const networkOk = await canNetwork();
      if (!networkOk) {
        return {
          allowed: false,
          effect: "deny",
          reasons: ["Sandbox: network access denied in strict mode"],
        };
      }
    }
  } catch {
    // Sandbox not initialized, skip
  }

  // Layer 2: Path security (for read/write actions)
  if (action === "read") {
    try {
      checkReadable(resource);
    } catch (e) {
      reasons.push(`Path security: ${(e as Error).message}`);
      return { allowed: false, effect: "deny", reasons };
    }
  }
  if (action === "edit" || action === "write" || action === "delete") {
    try {
      checkWritable(resource);
    } catch (e) {
      reasons.push(`Path security: ${(e as Error).message}`);
      return { allowed: false, effect: "deny", reasons };
    }
  }

  // Layer 3: Permission system
  const permission = check(action, resource, ...rulesets);
  if (permission.effect === "deny") {
    reasons.push(`Permissions: rule "${permission.matchedRule?.action}" → "${permission.matchedRule?.resource}" = deny`);
    return { allowed: false, effect: "deny", reasons };
  }

  return {
    allowed: permission.effect === "allow",
    effect: permission.effect,
    reasons: reasons.length > 0 ? reasons : [],
  };
}

/**
 * Quick check: is the tool allowed to execute?
 * Used by the tool engine before dispatching.
 */
export async function isToolAllowed(
  action: string,
  resource: string,
  agentPermissions: PermissionRuleset,
): Promise<{ allowed: boolean; needsApproval: boolean }> {
  const result = await checkSecurity(action, resource, [agentPermissions]);

  if (!result.allowed) return { allowed: false, needsApproval: false };

  return {
    allowed: true,
    needsApproval: result.effect === "ask",
  };
}
