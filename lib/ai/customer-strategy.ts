import { analyzeStructured } from './ai-service';
import { COMPANY } from '@/lib/config/company';

// ── Customer Analysis + Strategy ──

export interface CustomerAnalysis {
  company_summary: string;        // 一句话描述这个公司
  strengths: string[];             // 为什么值得开发（3-5条）
  risks: string[];                 // 可能的风险/挑战
  buying_signals: string[];        // 采购信号
  recommended_products: string[];  // 推荐推什么产品给他
}

export interface DevelopmentStrategy {
  approach: string;                // 开发思路（2-3句话）
  first_touch_angle: string;       // 首次触达的切入角度
  key_talking_points: string[];    // 沟通要点（3-5条）
  objection_handling: string[];    // 常见异议处理
  timeline: string;                // 预期开发周期
}

export interface PhoneScript {
  opening: string;                 // 开场白
  introduction: string;            // 自我介绍
  value_proposition: string;       // 价值主张
  questions_to_ask: string[];      // 要问客户的问题
  closing: string;                 // 收尾话术
  if_voicemail: string;            // 如果转语音信箱
}

export interface CustomerStrategyBundle {
  analysis: CustomerAnalysis;
  strategy: DevelopmentStrategy;
  phone_script: PhoneScript;
}

function validateStrategyBundle(data: unknown): CustomerStrategyBundle {
  if (!data || typeof data !== 'object') throw new Error('Not an object');
  const d = data as Record<string, any>;

  return {
    analysis: {
      company_summary: String(d.analysis?.company_summary || ''),
      strengths: Array.isArray(d.analysis?.strengths) ? d.analysis.strengths : [],
      risks: Array.isArray(d.analysis?.risks) ? d.analysis.risks : [],
      buying_signals: Array.isArray(d.analysis?.buying_signals) ? d.analysis.buying_signals : [],
      recommended_products: Array.isArray(d.analysis?.recommended_products) ? d.analysis.recommended_products : [],
    },
    strategy: {
      approach: String(d.strategy?.approach || ''),
      first_touch_angle: String(d.strategy?.first_touch_angle || ''),
      key_talking_points: Array.isArray(d.strategy?.key_talking_points) ? d.strategy.key_talking_points : [],
      objection_handling: Array.isArray(d.strategy?.objection_handling) ? d.strategy.objection_handling : [],
      timeline: String(d.strategy?.timeline || ''),
    },
    phone_script: {
      opening: String(d.phone_script?.opening || ''),
      introduction: String(d.phone_script?.introduction || ''),
      value_proposition: String(d.phone_script?.value_proposition || ''),
      questions_to_ask: Array.isArray(d.phone_script?.questions_to_ask) ? d.phone_script.questions_to_ask : [],
      closing: String(d.phone_script?.closing || ''),
      if_voicemail: String(d.phone_script?.if_voicemail || ''),
    },
  };
}

/**
 * Generate a complete customer strategy bundle:
 * analysis + development strategy + phone script + email template
 */
export async function generateCustomerStrategy(
  lead: Record<string, any>
): Promise<CustomerStrategyBundle | null> {
  const ai = lead.ai_analysis || {};
  const customs = lead.customs_summary || {};

  const prompt = `You are ${COMPANY.salesPerson}, a senior sales manager at ${COMPANY.name} (${COMPANY.description}).

CUSTOMER INFO:
- Company: ${lead.company_name}
- Website: ${lead.website || 'N/A'}
- Contact: ${lead.contact_name || 'Unknown'}
- Email: ${lead.contact_email || 'N/A'}
- Source: ${lead.source || 'N/A'}
- Product match: ${lead.product_match || 'N/A'}

AI ANALYSIS:
- Is apparel: ${ai.is_apparel_company ?? 'Unknown'}
- Company type: ${ai.company_type || 'Unknown'}
- Scale: ${ai.scale_estimate || 'Unknown'}
- Product categories: ${ai.product_categories?.join(', ') || 'Unknown'}
- Product fit score: ${ai.product_fit_score || 'Unknown'}
- AI recommendation: ${ai.outreach_recommendation || 'None'}

CUSTOMS DATA:
${customs.total_records ? `- Import records: ${customs.total_records}, value: $${customs.total_value_usd}` : '- No customs data available'}
${customs.is_apparel_importer ? '- Confirmed apparel importer' : ''}
${customs.top_hs_codes ? `- Top HS codes: ${JSON.stringify(customs.top_hs_codes)}` : ''}

OUR CAPABILITIES: ${COMPANY.products.join(', ')}
MOQ: ${COMPANY.moq} | Lead time: ${COMPANY.leadTime}

Generate a complete customer strategy. Think like a top-performing sales manager who knows the garment industry inside out.

ALL CONTENT MUST BE IN CHINESE (中文).

Respond with JSON (no markdown, no code fences):
{
  "analysis": {
    "company_summary": "一句话描述这个公司是什么、做什么",
    "strengths": ["为什么值得开发的理由1", "理由2", "理由3"],
    "risks": ["可能的风险/挑战1", "挑战2"],
    "buying_signals": ["采购信号1", "信号2"],
    "recommended_products": ["推荐推什么产品1", "产品2"]
  },
  "strategy": {
    "approach": "2-3句话的开发思路",
    "first_touch_angle": "首次联系的切入角度",
    "key_talking_points": ["沟通要点1", "要点2", "要点3"],
    "objection_handling": ["如果客户说XXX，回答YYY", "..."],
    "timeline": "预期开发周期（如：2-4周完成首次报价）"
  },
  "phone_script": {
    "opening": "电话开场白（中文+英文混合，像真人说话）",
    "introduction": "自我介绍话术",
    "value_proposition": "核心价值主张（为什么选我们）",
    "questions_to_ask": ["要问客户的问题1", "问题2", "问题3"],
    "closing": "收尾话术",
    "if_voicemail": "如果转语音信箱怎么说"
  }
}`;

  try {
    return await analyzeStructured<CustomerStrategyBundle>(
      prompt,
      'customer_strategy',
      validateStrategyBundle,
      { leadId: lead.id }
    );
  } catch (err) {
    console.error(`[Strategy] Failed for ${lead.company_name}:`, err);
    return null;
  }
}
