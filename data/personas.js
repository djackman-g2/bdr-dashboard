// Persona → G2 value map. The outreach hook = persona pain × account-specific
// signal: persona gives the angle, pulled proof gives the personalization.
// `proofToPull` names the G2/ZoomInfo query that turns the generic angle into
// a real hook. Committed (config, no account data) — see .gitignore carve-out.
export const personas = {
  marketing: {
    titles: ['CMO', 'VP Marketing', 'Demand Gen', 'Growth', 'Brand', 'Product Marketing'],
    wants: 'pipeline they can attribute, in-market accounts, category authority',
    g2Value:
      'Buyer Intent — see which target accounts are researching your category right now; Review velocity to win the Grid; AEO so you show up when buyers ask AI tools for a shortlist',
    hookAngle:
      "You are running demand gen but you can't see who's in-market until they fill a form. G2 shows you the accounts researching before that.",
    proofToPull: 'their buyer-intent signal count, category Grid position, review-volume gap vs top competitor',
  },
  productMarketing: {
    titles: ['PMM', 'Product Marketing', 'Competitive Intel', 'Messaging'],
    wants: 'competitive positioning, voice-of-customer, category narrative',
    g2Value:
      'Competitive intelligence on how buyers compare you vs rivals; unfiltered review language for messaging; category trend data',
    hookAngle:
      'The words your buyers use to compare you against [competitor] are sitting in your reviews — most PMMs never mine them.',
    proofToPull: 'competitive comparison data, review sentiment themes, category movement',
  },
  customerSuccess: {
    titles: ['CS', 'Customer Success', 'VP CS', 'Retention', 'Customer Marketing'],
    wants: 'reduce churn, prove value, mobilize advocates, references',
    g2Value:
      'Turn happy customers into reviews that feed the flywheel; catch at-risk sentiment early; source references on demand',
    hookAngle:
      'Your best customers would advocate publicly if asked at the right moment — G2 review campaigns systematize that instead of one-off asks.',
    proofToPull: 'current review count vs customer base size (the advocacy gap)',
  },
  productManagement: {
    titles: ['PM', 'Product Manager', 'VP Product', 'CPO', 'Head of Product'],
    wants: 'roadmap validation, competitive feature gaps, real user feedback',
    g2Value:
      'Structured feature-level feedback across your product AND competitors; see what users praise/pan about rivals to prioritize roadmap',
    hookAngle:
      "You're making roadmap bets partly on gut. Reviews of [competitor] show exactly which gaps are costing them deals.",
    proofToPull: 'competitor review pain points, feature-mention frequency, category feature trends',
  },
  sales: {
    titles: ['VP Sales', 'CRO', 'Sales Director', 'RevOps', 'Sales Enablement'],
    wants: 'more qualified pipeline, faster cycles, competitive win rates',
    g2Value:
      'Buyer Intent surfaces in-market accounts for reps; reviews as social proof in deals; competitive battlecards from real buyer comparisons',
    hookAngle:
      'Your reps are cold-calling blind. Intent data tells them which accounts are already researching this category this week.',
    proofToPull: 'intent signal volume in their ICP, competitive comparison frequency',
  },
  executive: {
    titles: ['CEO', 'Founder', 'COO', 'President', 'GM'],
    wants: 'category leadership, efficient growth, market perception',
    g2Value:
      'Own your category narrative; AI tools cite G2 first when buyers ask for recommendations — absence there = invisible in the AI buying journey',
    hookAngle:
      "When a buyer asks ChatGPT to recommend a [category] tool, it pulls from G2. You're not in that answer right now.",
    proofToPull: 'AI-citation absence (the screenshot play), Grid position, category presence',
  },
  demandGenSpecific: {
    // sub-persona, sharper than general marketing
    titles: ['Demand Gen', 'Growth Marketing', 'ABM', 'Paid'],
    wants: 'lower CAC, better-converting accounts, intent-based targeting',
    g2Value:
      'Feed G2 intent into your ABM/paid targeting so you spend on accounts already in-market, not spray-and-pray',
    hookAngle:
      'You could be targeting ads at accounts actively comparing you vs competitors instead of a lookalike guess.',
    proofToPull: 'in-market account count for their category',
  },
}

// Two universal stats to anchor any pitch.
export const anchorStats = {
  preSales: '75% of the B2B buying journey happens before a buyer talks to sales',
  aiCitations: '82% of AI citations come from third-party / earned sources, not your own site',
}
