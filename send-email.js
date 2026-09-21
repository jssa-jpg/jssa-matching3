// JSSA Matching Engine - Netlify Function
// 参加者データはサーバーサイドのみ。クライアントには一切送信されません。

const PARTICIPANTS = [
  {
    id: 1, company: "グリーンテック株式会社", position: "代表取締役CEO", name: "田中 誠",
    email: "tanaka@greentech.co.jp",
    attribute: "スタートアップ", memberType: "スタートアップ会員",
    purpose: ["資金調達元or資金支援先リサーチ"],
    currentRound: "Series A", wantRounds: [],
    wantAttribute: ["支援者"], listingStatus: "未上場企業", employeeScale: "1～10名",
    wantPosition: ["経営者・役員","専門職・コンサルタント・研究員"],
    industries: ["製造業・食品・環境・エネルギー・バイオ・宇宙・農林水産"],
    strengths: [], keywords: ["環境","再生エネルギー","脱炭素","SDGs","グリーン"],
    description: "環境テクノロジーで持続可能な社会を実現するスタートアップ。Series Aで資金調達中。"
  },
  {
    id: 2, company: "サクラベンチャーズ", position: "パートナー", name: "鈴木 花子",
    email: "suzuki@sakura-ventures.co.jp",
    attribute: "支援者", memberType: "スポンサー会員",
    purpose: ["資金調達元or資金支援先リサーチ"],
    currentRound: "", wantRounds: ["シード","アーリー","Series A"],
    wantAttribute: ["スタートアップ"], listingStatus: "未上場企業", employeeScale: "11～50名",
    wantPosition: ["経営者・役員"],
    industries: ["ITサービス・通信・Web.3","医療・ヘルスケア・福祉・保育・シニア","製造業・食品・環境・エネルギー・バイオ・宇宙・農林水産"],
    strengths: ["ベンチャー投資","事業戦略・ビジネスモデル設計支援","IPO・M&Aなど出口戦略の検討支援"],
    keywords: ["VC","投資","シード","Series A","スタートアップ支援"],
    description: "アーリー〜Series Aを中心に投資するVC。DeepTech・ヘルスケア領域に強み。"
  },
  {
    id: 3, company: "フィンテックソリューションズ株式会社", position: "取締役CFO", name: "山田 太郎",
    email: "yamada@fintechsol.co.jp",
    attribute: "スタートアップ", memberType: "スタートアップ会員",
    purpose: ["IPO支援元orIPO支援先リサーチ","資金調達元or資金支援先リサーチ"],
    currentRound: "Series B", wantRounds: [],
    wantAttribute: ["支援者"], listingStatus: "未上場企業", employeeScale: "51～100名",
    wantPosition: ["経営者・役員","専門職・コンサルタント・研究員"],
    industries: ["金融・保険・証券代行","コンサルタント・士業・監査法人"],
    strengths: [], keywords: ["フィンテック","決済","金融DX","IPO","資金調達"],
    description: "BtoB決済プラットフォームを展開。IPO準備中でアドバイザーを探している。"
  },
  {
    id: 4, company: "株式会社メディカルAI", position: "代表取締役", name: "伊藤 健",
    email: "ito@medicalai.co.jp",
    attribute: "スタートアップ", memberType: "スタートアップ会員",
    purpose: ["提携支援元or提携支援先リサーチ","資金調達元or資金支援先リサーチ"],
    currentRound: "アーリー", wantRounds: [],
    wantAttribute: ["支援者","スタートアップ"], listingStatus: "未上場企業", employeeScale: "11～50名",
    wantPosition: ["経営者・役員","事業部長・本部長"],
    industries: ["医療・ヘルスケア・福祉・保育・シニア","ITサービス・通信・Web.3"],
    strengths: [], keywords: ["AI","医療AI","診断支援","ヘルスケア","DX"],
    description: "画像診断AIを開発。病院・クリニックへの導入拡大と次ラウンド資金調達を検討中。"
  },
  {
    id: 5, company: "東京IPOアドバイザリー", position: "代表パートナー", name: "佐藤 美咲",
    email: "sato@tokyo-ipo.co.jp",
    attribute: "支援者", memberType: "サポート会員",
    purpose: ["IPO支援元orIPO支援先リサーチ"],
    currentRound: "", wantRounds: ["Series B","Series C","プレIPO"],
    wantAttribute: ["スタートアップ"], listingStatus: "上場企業", employeeScale: "11～50名",
    wantPosition: ["経営者・役員"],
    industries: ["金融・保険・証券代行","コンサルタント・士業・監査法人"],
    strengths: ["IPO・M&Aなど出口戦略の検討支援","財務管理・資金繰り・KPI設計支援","ガバナンス・内部体制整備支援"],
    keywords: ["IPO","上場","東証","グロース市場","監査","ガバナンス"],
    description: "年間10社以上のIPO支援実績。東証グロース市場への上場支援が専門。"
  },
  {
    id: 6, company: "ヒューマンキャピタル株式会社", position: "取締役", name: "中村 拓也",
    email: "nakamura@humancapital.co.jp",
    attribute: "支援者", memberType: "スポンサー会員",
    purpose: ["提携支援元or提携支援先リサーチ"],
    currentRound: "", wantRounds: ["シード","アーリー","Series A","Series B"],
    wantAttribute: ["スタートアップ","支援者"], listingStatus: "上場企業", employeeScale: "101～300名",
    wantPosition: ["経営者・役員","事業部長・本部長"],
    industries: ["人材・HR系サービス","ITサービス・通信・Web.3"],
    strengths: ["採用・組織づくり支援","営業・販路開拓支援"],
    keywords: ["採用","人材","HR","組織","タレントマネジメント"],
    description: "スタートアップ特化の人材紹介・採用支援。CxO採用から組織設計まで対応。"
  },
  {
    id: 7, company: "DXコンサルティングパートナーズ", position: "シニアコンサルタント", name: "渡辺 由美",
    email: "watanabe@dxcp.co.jp",
    attribute: "支援者", memberType: "サポート会員",
    purpose: ["提携支援元or提携支援先リサーチ","情報収集"],
    currentRound: "", wantRounds: ["アーリー","Series A","Series B"],
    wantAttribute: ["スタートアップ","支援者"], listingStatus: "問わず", employeeScale: "51～100名",
    wantPosition: ["経営者・役員","事業部長・本部長","部長・次長"],
    industries: ["ITサービス・通信・Web.3","製造業・食品・環境・エネルギー・バイオ・宇宙・農林水産","医療・ヘルスケア・福祉・保育・シニア"],
    strengths: ["事業戦略・ビジネスモデル設計支援","プロダクト開発・技術力の強化支援","マーケティング・ブランディング支援"],
    keywords: ["DX","デジタル変革","コンサル","IT戦略","業務改善"],
    description: "製造業・ヘルスケア領域のDX推進を専門とするコンサルタント。"
  },
  {
    id: 8, company: "株式会社アグリテック", position: "共同創業者COO", name: "小林 直樹",
    email: "kobayashi@agritech.co.jp",
    attribute: "スタートアップ", memberType: "スタートアップ会員",
    purpose: ["提携支援元or提携支援先リサーチ","資金調達元or資金支援先リサーチ"],
    currentRound: "シード", wantRounds: [],
    wantAttribute: ["支援者"], listingStatus: "未上場企業", employeeScale: "1～10名",
    wantPosition: ["経営者・役員","専門職・コンサルタント・研究員"],
    industries: ["製造業・食品・環境・エネルギー・バイオ・宇宙・農林水産","VC・CVC・エンジェル・投資事業"],
    strengths: [], keywords: ["農業","アグリテック","スマート農業","食品","サステナブル"],
    description: "IoTセンサーと機械学習で農業の生産性を向上するスタートアップ。"
  },
  {
    id: 9, company: "グローバルM&Aアドバイザーズ", position: "マネージングディレクター", name: "高橋 雄介",
    email: "takahashi@globalma.co.jp",
    attribute: "支援者", memberType: "協会ファンドLP投資家",
    purpose: ["資金調達元or資金支援先リサーチ","IPO支援元orIPO支援先リサーチ"],
    currentRound: "", wantRounds: ["Series B","Series C","プレIPO"],
    wantAttribute: ["スタートアップ"], listingStatus: "上場企業", employeeScale: "51～100名",
    wantPosition: ["経営者・役員"],
    industries: ["M&A仲介会社、FA","金融・保険・証券代行"],
    strengths: ["IPO・M&Aなど出口戦略の検討支援","財務管理・資金繰り・KPI設計支援"],
    keywords: ["M&A","買収","合併","EXIT","バリュエーション","FA"],
    description: "スタートアップのEXIT戦略（M&A・IPO）を支援する専門ファーム。"
  },
  {
    id: 10, company: "エドテック株式会社", position: "代表取締役", name: "松本 さくら",
    email: "matsumoto@edtech.co.jp",
    attribute: "スタートアップ", memberType: "スタートアップ会員",
    purpose: ["提携支援元or提携支援先リサーチ","情報収集"],
    currentRound: "アーリー", wantRounds: [],
    wantAttribute: ["支援者","スタートアップ"], listingStatus: "未上場企業", employeeScale: "11～50名",
    wantPosition: ["経営者・役員","事業部長・本部長"],
    industries: ["教育・研究機関・学校法人","ITサービス・通信・Web.3"],
    strengths: [], keywords: ["EdTech","教育","eラーニング","学習","子供","スキル"],
    description: "AIを活用した個別最適化学習プラットフォームを展開するEdTechスタートアップ。"
  },
  {
    id: 11, company: "ブロックチェーンラボ株式会社", position: "CTO", name: "西田 哲也",
    email: "nishida@bclab.co.jp",
    attribute: "スタートアップ", memberType: "非会員",
    purpose: ["資金調達元or資金支援先リサーチ","提携支援元or提携支援先リサーチ"],
    currentRound: "シード", wantRounds: [],
    wantAttribute: ["支援者"], listingStatus: "未上場企業", employeeScale: "1～10名",
    wantPosition: ["経営者・役員","専門職・コンサルタント・研究員"],
    industries: ["ITサービス・通信・Web.3","金融・保険・証券代行"],
    strengths: [], keywords: ["ブロックチェーン","Web3","NFT","DeFi","暗号資産","スマートコントラクト"],
    description: "エンタープライズ向けブロックチェーンソリューションを開発。Series A調達を目指す。"
  },
  {
    id: 12, company: "インパクトキャピタル", position: "ファンドマネージャー", name: "林 美穂",
    email: "hayashi@impact-capital.co.jp",
    attribute: "支援者", memberType: "協会ファンドLP投資家",
    purpose: ["資金調達元or資金支援先リサーチ"],
    currentRound: "", wantRounds: ["シード","アーリー","Series A"],
    wantAttribute: ["スタートアップ"], listingStatus: "未上場企業", employeeScale: "1～10名",
    wantPosition: ["経営者・役員"],
    industries: ["VC・CVC・エンジェル・投資事業","医療・ヘルスケア・福祉・保育・シニア","教育・研究機関・学校法人"],
    strengths: ["ベンチャー投資","経営判断の壁打ち相手・メンター","海外展開・グローバル戦略立案支援"],
    keywords: ["インパクト投資","社会課題","ESG","社会的インパクト","ヘルスケア","教育"],
    description: "社会的インパクトを重視したVC。ヘルスケア・教育・環境領域に特化した投資を行う。"
  },
  {
    id: 13, company: "スペーステックジャパン株式会社", position: "共同創業者", name: "藤田 航",
    email: "fujita@spacetech-jp.co.jp",
    attribute: "スタートアップ", memberType: "スタートアップ会員",
    purpose: ["資金調達元or資金支援先リサーチ","提携支援元or提携支援先リサーチ"],
    currentRound: "Series A", wantRounds: [],
    wantAttribute: ["支援者"], listingStatus: "未上場企業", employeeScale: "1～10名",
    wantPosition: ["経営者・役員","専門職・コンサルタント・研究員"],
    industries: ["製造業・食品・環境・エネルギー・バイオ・宇宙・農林水産","VC・CVC・エンジェル・投資事業"],
    strengths: [], keywords: ["宇宙","スペーステック","衛星","ロケット","宇宙ビジネス"],
    description: "小型衛星データを活用した地球観測サービスを提供。シードラウンド完了、Series A準備中。"
  }
];

const SYNONYM_MAP = {
  "資金調達": ["投資","ファンド","エクイティ","融資","調達","出資","VC","CVC"],
  "IPO": ["上場","株式公開","東証","グロース市場","EXIT"],
  "M&A": ["買収","合併","EXIT","売却","FA","アドバイザリー"],
  "IT": ["テック","Tech","DX","デジタル","システム","ソフトウェア","SaaS"],
  "医療": ["ヘルスケア","病院","クリニック","製薬","メドテック","MedTech"],
  "AI": ["人工知能","機械学習","ディープラーニング","ML","LLM"],
  "環境": ["グリーン","脱炭素","SDGs","サステナブル","ESG","再生エネルギー","カーボン"],
  "採用": ["人材","HR","リクルート","組織","タレント"],
  "コンサル": ["アドバイザー","コンサルタント","支援","顧問"],
  "スタートアップ": ["ベンチャー","新興企業","起業家","アントレプレナー"],
  "農業": ["アグリ","農産物","食品","食糧","スマート農業"],
  "教育": ["EdTech","学習","スクール","eラーニング"],
};

function expandWithSynonyms(keywords) {
  const expanded = new Set(keywords.map(k => k.toLowerCase()));
  for (const kw of keywords) {
    for (const [key, synonyms] of Object.entries(SYNONYM_MAP)) {
      if (kw.includes(key) || key.includes(kw)) {
        synonyms.forEach(s => expanded.add(s.toLowerCase()));
        expanded.add(key.toLowerCase());
      }
      if (synonyms.some(s => kw.toLowerCase().includes(s.toLowerCase()))) {
        expanded.add(key.toLowerCase());
        synonyms.forEach(s => expanded.add(s.toLowerCase()));
      }
    }
  }
  return Array.from(expanded);
}

function calcMatchScore(user, candidate) {
  if (candidate.name === user.name && candidate.company === user.company) return null;
  let score = 0, reasons = [];

  const userWantsCandidate = user.wantAttribute.includes("問わず") || user.wantAttribute.includes(candidate.attribute);
  const candidateWantsUser = candidate.wantAttribute.includes("問わず") || candidate.wantAttribute.includes(user.attribute);
  if (userWantsCandidate && candidateWantsUser) { score += 30; reasons.push("双方の属性が一致"); }
  else if (userWantsCandidate || candidateWantsUser) { score += 15; reasons.push("片方の属性が一致"); }

  const purposeMatch = user.purpose.some(p => candidate.purpose.includes(p));
  if (purposeMatch) {
    score += 20;
    const mp = user.purpose.find(p => candidate.purpose.includes(p));
    reasons.push(`目的「${mp?.split("or")[0]}」が一致`);
  }

  if (user.wantListingStatus === "問わず" || user.wantListingStatus === candidate.listingStatus) score += 10;
  if (user.wantEmployeeScale === "問わず" || user.wantEmployeeScale === candidate.employeeScale) score += 10;

  const positionRank = {"経営者・役員":7,"事業部長・本部長":6,"部長・次長":5,"課長・マネージャー":4,"係長・リーダー・主任":3,"一般社員":2,"専門職・コンサルタント・研究員":5};
  const wantedPositions = user.wantPosition || [];
  if (wantedPositions.includes("問わず") || wantedPositions.includes(candidate.position) ||
      wantedPositions.some(p => positionRank[p] && Math.abs((positionRank[p]||0)-(positionRank[candidate.position]||0))<=1)) {
    score += 10; reasons.push("希望役職クラスに合致");
  }

  const industryMatch = user.industries.some(i => candidate.industries.includes(i));
  if (industryMatch) {
    score += 15;
    const mi = user.industries.find(i => candidate.industries.includes(i));
    reasons.push(`業種「${mi?.split("・")[0]}」が一致`);
  }

  // 投資ラウンドマッチ
  if (user.attribute === "スタートアップ" && user.currentRound && candidate.wantRounds && candidate.wantRounds.length > 0) {
    if (candidate.wantRounds.includes(user.currentRound)) {
      score += 15; reasons.push(`投資ラウンド「${user.currentRound}」がマッチ`);
    }
  }
  if (user.attribute === "支援者" && user.wantRounds && user.wantRounds.length > 0 && candidate.currentRound) {
    if (user.wantRounds.includes(candidate.currentRound)) {
      score += 15; reasons.push(`投資ラウンド「${candidate.currentRound}」がマッチ`);
    }
  }

  const userKeywordsExpanded = expandWithSynonyms(user.searchKeywords || []);
  const candidateAllText = [candidate.company,candidate.description,...candidate.keywords,...candidate.industries,...candidate.strengths].join(" ").toLowerCase();
  let kwCount = 0;
  for (const kw of userKeywordsExpanded) {
    if (kw && candidateAllText.includes(kw)) kwCount++;
  }
  if (kwCount > 0) { score += Math.min(kwCount*5,15); reasons.push(`キーワードが${kwCount}件マッチ`); }

  if (candidate.attribute === "支援者" && candidate.strengths.length > 0) {
    const rel = candidate.strengths.filter(s => {
      if (user.purpose.includes("資金調達元or資金支援先リサーチ") && s.includes("投資")) return true;
      if (user.purpose.includes("IPO支援元orIPO支援先リサーチ") && s.includes("IPO")) return true;
      if (user.purpose.includes("提携支援元or提携支援先リサーチ") && (s.includes("営業")||s.includes("販路"))) return true;
      return false;
    });
    if (rel.length > 0) { score += 10; reasons.push(`支援強み「${rel[0].split("・")[0]}」が目的と一致`); }
  }

  return { candidate, score: Math.min(Math.round(score), 100), reasons };
}

// Rate limiting (in-memory, resets on cold start)
const rateLimit = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip;
  const entry = rateLimit.get(key) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  rateLimit.set(key, entry);
  return entry.count <= 30; // 30 requests per minute
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
  }
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const ip = event.headers["x-forwarded-for"]?.split(",")[0] || "unknown";

  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: "リクエストが多すぎます。しばらくお待ちください。" }) };
  }

  try {
    const user = JSON.parse(event.body);
    if (!user.company || !user.name || !user.attribute) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "必須項目が不足しています" }) };
    }

    const results = PARTICIPANTS
      .map(p => calcMatchScore(user, p))
      .filter(r => r !== null && r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((r, i) => ({
        rank: i + 1,
        company: r.candidate.company,
        position: r.candidate.position,
        name: r.candidate.name,
        attribute: r.candidate.attribute,
        memberType: r.candidate.memberType,
        industries: r.candidate.industries,
        description: r.candidate.description,
        currentRound: r.candidate.currentRound || "",
        wantRounds: r.candidate.wantRounds || [],
        strengths: r.candidate.strengths || [],
        score: r.score,
        reasons: r.reasons,
        // メールは結果に含めない（送信時に別途サーバーで解決）
        hasEmail: !!r.candidate.email
      }));

    return { statusCode: 200, headers, body: JSON.stringify({ results }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
