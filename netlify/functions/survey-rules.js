// 新しいマッチングアンケート（①属性 ②業種・領域 ③面談の目的 ④会いたい部署）の選択肢と照合ルール
// match.js（候補の選定）・admin-api.js（一致条件の表示）・collect-company-info.js（AI分類）で共通に使う

const ANY = 'こだわらない';
const OTHER = 'その他（自由記入）';

const ATTRIBUTES = ['大企業・事業会社', 'スタートアップ', 'VC・投資ファンド', 'CVC・事業会社の投資部門', 'エンジェル投資家', '銀行・信用金庫', 'M&A仲介会社・FA', 'コンサルティング会社', '士業・監査法人', '大学・研究機関', '官公庁・自治体', '業界団体・支援機関'];

const INDUSTRY_GROUPS = {
  'IT・先端技術': ['AI', 'ITサービス・SaaS', '通信', 'Web3・ブロックチェーン', 'ロボット・自動化', '半導体・電子部品', '宇宙・航空', 'その他ディープテック'],
  '産業・インフラ': ['製造業', '建設', '不動産', '物流・運輸', 'モビリティ・自動車', 'エネルギー', '環境・脱炭素', '農業・水産業'],
  '消費者向け事業': ['食品・飲料', '小売・流通', 'EC', '観光・宿泊', 'エンタメ', 'スポーツ', 'アート・文化', '美容・ファッション'],
  '社会・生活': ['医療・ヘルスケア', '介護・福祉', '保育・子育て', '教育', '人材・HRサービス'],
  'ビジネス支援': ['金融・FinTech', '保険', '広告・マーケティング', 'メディア・出版', '商社', '経営コンサルティング', 'AI・DXコンサルティング', '人事・採用コンサルティング', 'M&A支援', '法務・会計・税務'],
};
const INDUSTRIES = Object.values(INDUSTRY_GROUPS).flat();

const PURPOSES = ['顧客・販路の開拓', '業務提携・共同事業', '新規事業・オープンイノベーション', '資金調達・出資', 'M&A・事業承継', '技術開発・共同研究', '採用・人材紹介', '専門家への相談', '情報交換'];

const DEPARTMENTS = ['経営者・役員', '経営企画・事業戦略', '新規事業・オープンイノベーション', 'CVC・投資', 'M&A・事業開発', '営業・販路開拓', 'マーケティング・広報', '商品・サービス企画', '研究開発・技術開発', 'DX・情報システム', 'AI活用推進', '人事・採用', '購買・調達', '財務・経理', '法務・知的財産', 'サステナビリティ・環境', '自治体の産業振興・スタートアップ支援', '大学の産学連携・研究支援'];

// 部署名・役職名に含まれる言葉で「会いたい部署」を判定する
const DEPT_KEYWORDS = {
  '経営者・役員': ['代表', '社長', '会長', '取締役', '役員', '執行役', 'CEO', 'COO', 'CFO', 'CTO', 'CMO', 'CSO', 'CIO', 'CHRO', 'ファウンダー', 'Founder', 'President', 'Partner', 'パートナー', '理事長', '頭取', '組合長', '市長', '町長', '村長', '知事', '学長', '総長'],
  '経営企画・事業戦略': ['経営企画', '経営戦略', '事業戦略', '事業企画', '企画室', '戦略企画', '社長室', '経営管理', 'コーポレート戦略', 'Strategy'],
  '新規事業・オープンイノベーション': ['新規事業', '新事業', 'イノベーション', 'インキュベーション', '事業創造', '事業開発', 'アクセラレ', 'Innovation', 'Incubat'],
  'CVC・投資': ['CVC', '投資', 'ベンチャーキャピタル', 'インベストメント', 'キャピタル', 'ファンド', 'Invest', 'Venture'],
  'M&A・事業開発': ['M&A', 'Ｍ＆Ａ', '事業開発', 'アライアンス', 'Business Development', 'BizDev', '提携', '事業承継'],
  '営業・販路開拓': ['営業', 'セールス', 'Sales', '販売', '販路', '法人', 'アカウント', '顧客'],
  'マーケティング・広報': ['マーケティング', 'Marketing', '広報', 'PR', '宣伝', 'ブランド', 'コミュニケーション'],
  '商品・サービス企画': ['商品企画', 'サービス企画', 'プロダクト', 'Product', '商品開発', 'サービス開発', '企画部'],
  '研究開発・技術開発': ['研究', '開発', 'R&D', 'Ｒ＆Ｄ', '技術', 'エンジニア', 'Engineer', 'ラボ', 'Lab'],
  'DX・情報システム': ['DX', 'ＤＸ', 'デジタル', '情報システム', 'IT', 'システム', 'Digital'],
  'AI活用推進': ['AI', 'ＡＩ', '人工知能', 'データサイエンス', 'データ活用', '生成AI', 'Data'],
  '人事・採用': ['人事', '採用', '人材', 'HR', 'ＨＲ', '労務', 'People', 'Talent'],
  '購買・調達': ['購買', '調達', '資材', 'Procurement', 'サプライ'],
  '財務・経理': ['財務', '経理', '会計', 'ファイナンス', 'Finance', 'IR', '資金'],
  '法務・知的財産': ['法務', '知的財産', '知財', 'コンプライアンス', 'Legal', '弁護士', '弁理士'],
  'サステナビリティ・環境': ['サステナビリティ', 'サステナブル', '環境', 'ESG', 'SDGs', 'カーボン', '脱炭素', 'GX'],
  '自治体の産業振興・スタートアップ支援': ['産業振興', '経済', '商工', '企業誘致', 'スタートアップ', '創業', '起業', 'イノベーション推進', '産業政策'],
  '大学の産学連携・研究支援': ['産学', '産官学', '連携推進', '研究支援', 'URA', 'TLO', '知的財産本部', 'イノベーション推進機構', '共同研究'],
};

// 面談の目的に合う相手（属性・部署）。一致すると加点する
const PURPOSE_FIT = {
  '顧客・販路の開拓': { attributes: ['大企業・事業会社', '官公庁・自治体'], departments: ['営業・販路開拓', '購買・調達', '商品・サービス企画', 'DX・情報システム'] },
  '業務提携・共同事業': { attributes: ['大企業・事業会社', 'スタートアップ'], departments: ['M&A・事業開発', '新規事業・オープンイノベーション', '経営企画・事業戦略'] },
  '新規事業・オープンイノベーション': { attributes: ['大企業・事業会社', 'CVC・事業会社の投資部門'], departments: ['新規事業・オープンイノベーション', '経営企画・事業戦略', 'CVC・投資'] },
  '資金調達・出資': { attributes: ['VC・投資ファンド', 'CVC・事業会社の投資部門', 'エンジェル投資家', '銀行・信用金庫'], departments: ['CVC・投資', '財務・経理', '経営者・役員'] },
  'M&A・事業承継': { attributes: ['M&A仲介会社・FA', '大企業・事業会社', '銀行・信用金庫'], departments: ['M&A・事業開発', '経営企画・事業戦略', '経営者・役員'] },
  '技術開発・共同研究': { attributes: ['大学・研究機関', '大企業・事業会社'], departments: ['研究開発・技術開発', '大学の産学連携・研究支援', 'AI活用推進'] },
  '採用・人材紹介': { attributes: ['大企業・事業会社'], departments: ['人事・採用'] },
  '専門家への相談': { attributes: ['士業・監査法人', 'コンサルティング会社', 'M&A仲介会社・FA'], departments: ['法務・知的財産', '財務・経理', '経営者・役員'] },
  '情報交換': { attributes: [], departments: [] },
};

const norm = v => String(v || '').normalize('NFKC').toLowerCase();

// 名刺の部署・役職が「会いたい部署」に当てはまるか
function departmentFits(dept, card) {
  const text = norm(`${card.department || ''} ${card.position || ''}`);
  const kws = DEPT_KEYWORDS[dept] || [];
  return kws.some(k => text.includes(norm(k)));
}

// 会員の回答（新アンケート）が新形式か
function isNewSurvey(ans) {
  return !!(ans && (ans.attribute || ans.industryDetail || (Array.isArray(ans.purposes) && ans.purposes.length) || (Array.isArray(ans.departments) && ans.departments.length)));
}

// 名刺1枚について、各設問の一致を判定する
// 戻り値の各値：true=一致 / false=不一致 / null=こだわらない・判定不能
function evaluateCard(ans, card) {
  const res = { attribute: null, industry: null, purposes: [], departments: [], departmentMatch: null, score: 10 };
  const text = norm(`${card.company || ''} ${card.features || ''} ${card.department || ''}`);
  const cardInds = String(card.industryDetail || '').split(/[／/、,]/).map(s => s.trim()).filter(Boolean);

  // ① 属性（40点）
  if (ans.attribute && ans.attribute !== ANY) {
    if (ans.attribute === OTHER) {
      const kw = norm(ans.attributeOther);
      res.attribute = kw ? text.includes(kw) : null;
    } else if (ATTRIBUTES.includes(card.attribute)) {
      res.attribute = card.attribute === ans.attribute;
    } else {
      res.attribute = null; // まだAI分類されていない名刺
    }
    if (res.attribute) res.score += 40;
  } else res.score += 10;

  // ② 業種・領域（30点）
  if (ans.industryDetail && ans.industryDetail !== ANY) {
    if (ans.industryDetail === OTHER) {
      const kw = norm(ans.industryOther);
      res.industry = kw ? text.includes(kw) : null;
    } else if (cardInds.length) {
      res.industry = cardInds.includes(ans.industryDetail);
    } else {
      res.industry = null;
    }
    if (res.industry) res.score += 30;
  } else res.score += 8;

  // ④ 会いたい部署（20点）
  const allDepts = (ans.departments || []).filter(Boolean);
  const depts = allDepts.filter(d => d !== OTHER);
  if (allDepts.length && !allDepts.includes(ANY)) {
    res.departments = depts.filter(d => departmentFits(d, card));
    if ((ans.departments || []).includes(OTHER) && ans.departmentOther) {
      const kw = norm(ans.departmentOther);
      if (kw && norm(`${card.department || ''} ${card.position || ''}`).includes(kw)) res.departments.push(ans.departmentOther);
    }
    res.departmentMatch = res.departments.length > 0;
    if (res.departmentMatch) res.score += 20;
  } else res.score += 8;

  // ③ 面談の目的（目的1つにつき最大10点）
  for (const p of (ans.purposes || [])) {
    const fit = PURPOSE_FIT[p];
    if (!fit) continue;
    const okAttr = card.attribute && fit.attributes.includes(card.attribute);
    const okDept = fit.departments.some(d => departmentFits(d, card));
    if (okAttr || okDept) { res.purposes.push(p); res.score += 10; }
  }
  return res;
}
const MAX_SCORE = 120;

module.exports = { ANY, OTHER, ATTRIBUTES, INDUSTRY_GROUPS, INDUSTRIES, PURPOSES, DEPARTMENTS, DEPT_KEYWORDS, PURPOSE_FIT, departmentFits, isNewSurvey, evaluateCard, MAX_SCORE };
