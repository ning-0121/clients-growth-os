import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAllAgents } from '@/lib/agents';

/**
 * GET /api/agents/status
 * Returns the status of all agents and recent task history.
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Get registered agents
    const agents = getAllAgents().map((a) => ({
      role: a.role,
      pipeline: a.pipeline,
      description: a.description,
    }));

    // Get recent tasks
    const { data: recentTasks } = await supabase
      .from('agent_tasks')
      .select('id, agent_role, pipeline, status, created_at, completed_at, error')
      .order('created_at', { ascending: false })
      .limit(50);

    // Get stats
    const { data: stats } = await supabase
      .from('agent_tasks')
      .select('agent_role, status')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const taskStats = (stats || []).reduce((acc: Record<string, Record<string, number>>, task: { agent_role: string; status: string }) => {
      if (!acc[task.agent_role]) acc[task.agent_role] = { completed: 0, failed: 0, running: 0 };
      acc[task.agent_role][task.status] = (acc[task.agent_role][task.status] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      agents,
      recentTasks: recentTasks || [],
      stats24h: taskStats,
      pipelines: {
        outbound: { name: '主动搜索', agents: agents.filter((a) => a.pipeline === 'outbound').length },
        inbound: { name: '宣传引流', agents: agents.filter((a) => a.pipeline === 'inbound').length },
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
