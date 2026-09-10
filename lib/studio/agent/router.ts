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
 * Independent verifier selection for a storyboard revision. Preserves the
 * historical preference order: reviewer → continuity → director, then any
 * enabled qa/continuity role — never the author.
 */
export function selectVerifier(
  roles: readonly AgentDefinition[],
  authorRoleId: string,
): AgentDefinition | undefined {
  return (
    ['reviewer', 'continuity', 'director']
      .map((id) => roles.find((r) => r.id === id && r.id !== authorRoleId))
      .find(Boolean) ??
    roles.find(
      (r) => r.id !== authorRoleId && r.stages.some((s) => s === 'qa' || s === 'continuity'),
    )
  );
}
