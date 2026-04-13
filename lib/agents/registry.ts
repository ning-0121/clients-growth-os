/**
 * Agent Registry — Central registration and lookup for all agents.
 */

import { Agent, AgentRole } from './types';

const agents = new Map<AgentRole, Agent>();

export function registerAgent(agent: Agent) {
  agents.set(agent.role, agent);
}

export function getAgent(role: AgentRole): Agent | undefined {
  return agents.get(role);
}

export function getAllAgents(): Agent[] {
  return Array.from(agents.values());
}

export function getAgentsByPipeline(pipeline: 'outbound' | 'inbound'): Agent[] {
  return Array.from(agents.values()).filter((a) => a.pipeline === pipeline);
}
