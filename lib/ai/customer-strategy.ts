import { analyzeStructured } from './ai-service';
import { COMPANY } from '@/lib/config/company';
import { CustomerResearch } from './customer-research';

export interface CustomerAnalysis {
  company_summary: string;
  strengths: string[];
  risks: string[];
  buying_signals: string[];
  recommended_products: string[];
}

export interface DevelopmentStrategy {
  approach: string;
  first_touch_angle: string;
  key_talking_points: string[];
  objection_handling: string[];
  timeline: string;
}

export interface PhoneScript {
  opening: string;
  introduction: string;
  value_proposition: string;
  questions_to_ask: string[];
  closing: string;
  if_voicemail: string;
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

export async function generateCustomerStrategy(
  lead: Record<string, any>,
  research?: CustomerResearch | null
): Promise<CustomerStrategyBundle | null> {
  const ai = lead.ai_analysis || {};
  const customs = lead.customs_summary || {};
  const categories = ai.product_categories?.join(', ') || lead.product_match || '未知';
  const companyType = ai.company_type || '未知';
  const scale = ai.scale_estimate || '未知';
  const r = research || {} as CustomerResearch;

  // Determine customer archetype for targeted strategy
  const archetype = detectArchetype(ai, customs, lead);

  const prompt = `你是一个在中国服装出口行业干了15年的**顶级外贸销售总监**。你不是写报告的人，你是真正上过战场、签过千万订单的人。

你的公司：${COMPANY.name}
核心产品：运动服（Activewear）、瑜伽服、网球服、高尔夫服、压缩衣、卫衣、T恤
模式：OEM / ODM / Private Label
MOQ：300-500件/色/款（首单可谈200件）
生产周期：30-45天
面料优势：拥有自己的面料合作工厂，可以做4-way stretch、moisture wicking、recycled polyester、nylon/spandex blend
价格区间：T恤 $3.5-6 FOB，卫衣 $8-14 FOB，压缩裤 $6-10 FOB，外套 $12-22 FOB
交货：FOB 宁波/上海

---

现在分析这个客户：

**公司名**：${lead.company_name}
**网站**：${lead.website || '无'}
**联系人**：${lead.contact_name || '未知'}
**邮箱**：${lead.contact_email || '无'}
**来源**：${lead.source || '未知'}
**产品匹配**：${categories}
**公司类型**：${companyType}
**公司规模**：${scale}
${ai.key_evidence ? `**网站关键信息**：${ai.key_evidence.join('；')}` : ''}
${ai.outreach_recommendation ? `**AI初步建议**：${ai.outreach_recommendation}` : ''}

**海关数据**：
${customs.total_records ? `- 进口记录 ${customs.total_records} 条，总金额 $${customs.total_value_usd?.toLocaleString()}` : '- 无海关数据'}
${customs.is_apparel_importer ? '- 已确认是服装进口商' : ''}
${customs.avg_monthly_imports ? `- 月均进口 ${customs.avg_monthly_imports} 次` : ''}
${customs.origin_countries?.length ? `- 进口来源国：${customs.origin_countries.join(', ')}` : ''}

**客户画像**：${archetype}

═══════════════════════════════════
以下是我们对这个客户的**深度调研结果**（真实数据，不是猜测）：
═══════════════════════════════════

**网站深度扫描**（扫描了${r.website_pages_scanned || 0}个页面）：
${r.products_found?.length ? `- 发现的产品：${r.products_found.slice(0, 15).join('、')}` : '- 未扫描到具体产品'}
${r.price_range ? `- 网站标价区间：${r.price_range}` : '- 未发现价格信息'}
${r.about_info ? `- 公司介绍：${r.about_info.slice(0, 500)}` : '- 无About页信息'}
${r.team_size_clue ? `- 团队规模线索：${r.team_size_clue}` : ''}
${r.shipping_markets?.length ? `- 销售市场：${r.shipping_markets.join(', ')}` : ''}
${Object.keys(r.social_links || {}).length ? `- 社交媒体：${Object.entries(r.social_links || {}).map(([k,v]) => `${k}: ${v}`).join(', ')}` : ''}

**Google 搜索情报**：
${r.google_mentions?.length ? r.google_mentions.slice(0, 3).map((m: string) => `- ${m}`).join('\n') : '- 无Google搜索结果'}
${r.competitors_mentioned?.length ? `- 提到的竞品/同行：${r.competitors_mentioned.join(', ')}` : ''}

**LinkedIn 情报**：
${r.linkedin_summary ? `- 公司简介：${r.linkedin_summary}` : '- 无LinkedIn数据'}
${r.employee_count_estimate ? `- 员工规模：${r.employee_count_estimate}` : ''}
${r.job_openings?.length ? `- 正在招聘：${r.job_openings.join('、')}（说明公司在扩张）` : ''}
${r.key_people?.length ? `- 关键人物：${r.key_people.join(', ')}` : ''}

**海关贸易数据**：
${r.customs_summary || customs.total_records ? (r.customs_summary || `${customs.total_records}条记录，$${customs.total_value_usd?.toLocaleString()}`) : '- 无海关匹配数据'}
${r.origin_countries?.length ? `- 进口来源国：${r.origin_countries.join(', ')}` : (customs.origin_countries?.length ? `- 进口来源国：${customs.origin_countries.join(', ')}` : '')}
${r.hs_codes?.length ? `- HS编码：${r.hs_codes.join(', ')}` : ''}

**网站原始内容（关键摘录）**：
${r.raw_website_text?.slice(0, 2000) || '无'}

---

**你的任务**：像一个真正懂行的销售总监一样，给出落地的、具体的、有行业深度的分析和策略。

**严格要求**：
1. 不要说空话废话。"该客户是一个有潜力的品牌"这种话等于没说。要说具体的：他们做什么产品、卖什么价位、在哪个市场、我们能切入的角度是什么
2. 策略要具体到动作。不要说"建议建立联系"，要说"先在LinkedIn上关注他们的sourcing manager，评论他们最近的产品贴，第三天发开发信切入他们最近推的跑步系列"
3. 电话话术要像真人说话。混合中英文，就像你真的在给美国/欧洲客户打电话
4. 异议处理要基于真实场景。客户说"价格太高"不是回答"我们价格有竞争力"，而是"Could you share the target price? We can adjust the fabric spec — for example, switching from nylon to recycled poly can save $1-2 per piece without compromising the feel"
5. 推荐产品要具体。不要说"运动服"，要说"他们网站主推的高腰瑜伽裤，我们可以用 Nylon 72% / Spandex 28% 的四面弹面料做，hand feel 接近 lululemon Align，FOB $7-8"

**输出要求**：所有内容用中文，但电话话术和开发策略中涉及跟外国客户沟通的部分用英文（因为实际沟通是用英文）。

输出 JSON（不要 markdown，不要代码块）：
{
  "analysis": {
    "company_summary": "1-2句话精准描述这个公司做什么、卖给谁、什么规模（要具体）",
    "strengths": ["为什么值得花时间开发这个客户（要具体到业务层面）", "...", "..."],
    "risks": ["这个客户可能有什么坑/挑战（要真实）", "..."],
    "buying_signals": ["从已有信息推断的采购信号", "..."],
    "recommended_products": ["具体产品+面料+大致FOB价格，如：高腰瑜伽裤 Nylon/Spandex FOB $7-8", "..."]
  },
  "strategy": {
    "approach": "2-3句话的开发思路（要具体到步骤和时间）",
    "first_touch_angle": "第一次联系切入什么话题（要具体引用他们的产品或最近动态）",
    "key_talking_points": ["跟客户聊天时的关键话题，每个都要具体", "...", "..."],
    "objection_handling": ["如果客户说 'Your MOQ is too high' → 具体回答（英文）", "如果客户说 'We already have a supplier' → 具体回答（英文）", "如果客户说 'Price is too high' → 具体回答（英文）"],
    "timeline": "预期开发周期和关键节点"
  },
  "phone_script": {
    "opening": "Hey [name], this is ${COMPANY.salesPerson} calling from China — I know this might be unexpected, [后面怎么说让对方不挂电话]",
    "introduction": "简短自我介绍（英文，要有行业关键词让对方感兴趣）",
    "value_proposition": "核心价值主张：我们能给你什么你现有供应商给不了的（要具体，不要泛泛而谈）",
    "questions_to_ask": ["What categories are you looking to develop for next season?", "Are you currently sourcing from China?", "What's your typical order quantity per style?", "再加2-3个针对这个客户类型的问题"],
    "closing": "收尾话术：怎么优雅地把话题引到样品/报价（英文）",
    "if_voicemail": "30秒内的语音留言话术（英文，要让对方想回电话）"
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

/**
 * Detect customer archetype for targeted strategy
 */
function detectArchetype(ai: any, customs: any, lead: any): string {
  const types: string[] = [];

  // By company type
  if (ai.company_type === 'brand') {
    if (ai.scale_estimate === 'large') types.push('大品牌（可能有固定供应链，需要找到切入点，如新品类/新面料/价格优势）');
    else if (ai.scale_estimate === 'medium') types.push('中型品牌（正在扩张，可能需要稳定的OEM伙伴，决策相对快）');
    else types.push('小品牌/DTC品牌（可能刚起步，MOQ敏感，需要设计支持，看重灵活性）');
  } else if (ai.company_type === 'retailer') {
    types.push('零售商/买手店（看重价格和交期，品类要全，可能有seasonal buying calendar）');
  } else if (ai.company_type === 'wholesaler') {
    types.push('批发商（大量走货，对价格极敏感，要能做大货）');
  }

  // By source
  if (lead.source === 'customs') types.push('海关数据来源（已确认有进口记录，是真实买家）');
  if (lead.source === 'ig') types.push('Instagram品牌（可能是DTC模式，注重视觉和品牌感）');
  if (lead.source === 'linkedin') types.push('LinkedIn来源（可能是采购决策人）');

  // By customs data
  if (customs.total_value_usd > 500000) types.push('年进口>50万美元的大客户');
  else if (customs.total_value_usd > 100000) types.push('年进口10-50万美元的中型客户');

  if (customs.is_apparel_importer) types.push('确认的服装进口商');

  // By product
  const products = ai.product_categories || [];
  if (products.some((p: string) => p.toLowerCase().includes('yoga') || p.toLowerCase().includes('legging'))) {
    types.push('瑜伽/紧身裤品类（高面料要求，利润空间大）');
  }
  if (products.some((p: string) => p.toLowerCase().includes('athletic') || p.toLowerCase().includes('sport'))) {
    types.push('运动服品类（功能性面料需求，有技术门槛）');
  }

  return types.length > 0 ? types.join('。') : '信息有限，需要进一步调研再制定针对性策略';
}
