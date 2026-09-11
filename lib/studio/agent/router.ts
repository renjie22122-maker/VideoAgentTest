import type { AgentDefinition } from '../team-config.ts';
import { capabilitiesForRole } from './capabilities.ts';
import type { CapabilityId } from './capabilities.ts';

/**
 * Capability Router: picks the eligible agent for a required capability.
 * Roles are personas + default grants; routing asks "who may do this", not
 * "who does the planner feel like".
 */
export function routeCapability(
  roles: readonly AgentDefinition[],
  capability: CapabilityId,
  excludeRoleId?: string,
): AgentDefinition | undefined {
  return roles.find(
    (r) => r.id !== excludeRoleId && capabilitiesForRole(r.id, roles).includes(capability),
  );
}

/**
 * Independent verifier selection for a storyboard revision. Capability first:
 * only roles that grant verify_storyboard are eligible (declared grants win,
 * director is explicitly granted by default), the author is excluded, and the
 * historical preference order reviewer → continuity → director applies after
 * the capability filter — never as a substitute for it.
 */
export function selectVerifier(
  roles: readonly AgentDefinition[],
  authorRoleId: string,
): AgentDefinition | undefined {
  const capable = roles.filter(
    (r) => r.id !== authorRoleId && capabilitiesForRole(r.id, roles).includes('verify_storyboard'),
  );
  const preferred = ['reviewer', 'continuity', 'director']
    .map((id) => capable.find((r) => r.id === id))
    .find(Boolean);
  if (preferred) return preferred;
  return capable.find((r) => r.stages.some((s) => s === 'qa' || s === 'continuity'));
}
