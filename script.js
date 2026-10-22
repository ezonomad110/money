"use strict";

const $ = id => document.getElementById(id);

const SCENARIOS = {
  basic: { name:"基本シナリオ", color:"#2563eb" },
  crash: { name:"暴落シナリオ", color:"#dc2626" },
  low:   { name:"低迷シナリオ", color:"#16a34a" }
};

const EPSILON = 0.000001;
const MAX_AMOUNT = 1e9; // 万円単位。異常に大きな入力を防ぐ

function num(id) {
  const el = $(id);
  const value = el ? Number(el.value) : 0;
  return Number.isFinite(value) ? value : 0;
}
function pct(id) { return num(id) / 100; }
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function money(value) {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("ja-JP") + "万円";
}
function selectedHousing() {
  return document.querySelector('input[name="housing"]:checked')?.value || "rent";
}
function selectedHomeStatus() {
  return document.querySelector('input[name="homeStatus"]:checked')?.value || "new";
}

function readConfig() {
  const currentAge = Math.round(clamp(num("currentAge"), 18, 100));
  const lifeAge = Math.round(clamp(num("lifeAge"), currentAge, 120));

  return {
    currentAge,
    fireAge: Math.round(clamp(num("fireAge"), currentAge, lifeAge)),
    lifeAge,
    cash: num("cash"),
    investments: num("investments"),
    dc: num("dc"),
    dcAge: Math.round(clamp(num("dcAge"), 40, 100)),
    inflation: pct("inflation"),
    baseReturn: pct("baseReturn"),

    salary: num("salary"),
    pension65: num("pension65"),
    pensionAge: Math.round(clamp(num("pensionAge"), 60, 75)),
    preLiving: num("preLiving"),
    postLiving: num("postLiving"),
    sideIncome: num("sideIncome"),
    sideEndAge: Math.round(clamp(num("sideEndAge"), 18, 120)),

    housing: selectedHousing(),
    rentMonthly: num("rentMonthly"),
    rentGrowth: pct("rentGrowth"),

    homeStatus: selectedHomeStatus(),
    homePrice: num("homePrice"),
    downPayment: num("downPayment"),
    purchaseCostPct: num("purchaseCostPct") / 100,
    loanYears: Math.round(num("loanYears")),
    currentLoanBalance: num("currentLoanBalance"),
    remainingLoanYears: Math.round(num("remainingLoanYears")),
    loanRate: pct("loanRate"),
    homeTax: num("homeTax"),
    homeMaintenance: num("homeMaintenance"),

    crashPct: pct("crashPct"),
    crashAge: Math.round(num("crashAge")),
    crashReturn: pct("crashReturn"),
    lowYears: Math.round(num("lowYears")),
    lowReturn: pct("lowReturn"),
    lowAfterReturn: pct("lowAfterReturn")
  };
}

/* 給与手取りの簡易推計（万円） */
function progressiveIncomeTax(taxable) {
  const brackets = [
    [195, .05, 0],
    [330, .10, 9.75],
    [695, .20, 42.75],
    [900, .23, 63.6],
    [1800, .33, 153.6],
    [4000, .40, 279.6],
    [Infinity, .45, 479.6]
  ];
  for (const [limit, rate, deduction] of brackets) {
    if (taxable <= limit) return Math.max(0, taxable * rate - deduction);
  }
  return 0;
}

function salaryNet(gross) {
  if (gross <= 0) return 0;

  let employmentDeduction;
  if (gross <= 162.5) employmentDeduction = 55;
  else if (gross <= 180) employmentDeduction = gross * .4 - 10;
  else if (gross <= 360) employmentDeduction = gross * .3 + 8;
  else if (gross <= 660) employmentDeduction = gross * .2 + 44;
  else if (gross <= 850) employmentDeduction = gross * .1 + 110;
  else employmentDeduction = 195;

  const salaryIncome = Math.max(0, gross - employmentDeduction);
  const socialInsurance = gross * .145;
  const taxableIncome = Math.max(0, salaryIncome - 48 - socialInsurance);
  const incomeTax = progressiveIncomeTax(taxableIncome);
  const residentTax = Math.max(0, salaryIncome - 43 - socialInsurance) * .10;

  return Math.max(0, gross - socialInsurance - incomeTax - residentTax);
}

/* 年金の繰上げ・繰下げを反映した簡易推計 */
function pensionGross(c) {
  let factor = 1;

  if (c.pensionAge < 65) {
    factor = 1 - (65 - c.pensionAge) * 12 * .004;
  } else if (c.pensionAge > 65) {
    factor = 1 + (c.pensionAge - 65) * 12 * .007;
  }

  return c.pension65 * factor;
}
function pensionNet(gross) {
  if (gross <= 0) return 0;

  const pensionDeduction = gross <= 110
    ? gross
    : Math.max(110, gross * .25 + 27.5);

  const taxable = Math.max(0, gross - pensionDeduction - 48);
  const incomeTax = progressiveIncomeTax(taxable);
  const residentTax = taxable * .10;
  const insurance = gross * .08;

  return Math.max(0, gross - incomeTax - residentTax - insurance);
}

function loanAnnualPayment(principal, annualRate, years) {
  if (principal <= 0) return 0;
  if (!Number.isFinite(years) || years <= 0) {
    throw new Error("借入残高がある場合、住宅ローン期間は1年以上必要です。");
  }
  if (annualRate === 0) return principal / years;

  const factor = Math.pow(1 + annualRate, years);
  return principal * annualRate * factor / (factor - 1);
}

/* 新規購入時は住宅価格から頭金を引いた額。購入済みは現在残高。 */
function mortgagePrincipal(c) {
  if (c.homeStatus === "existing") return c.currentLoanBalance;
  if (c.homeStatus === "paid") return 0;
  return Math.max(0, c.homePrice - c.downPayment);
}
function mortgageYears(c) {
  if (c.homeStatus === "existing") return c.remainingLoanYears;
  if (c.homeStatus === "paid") return 0;
  return c.loanYears;
}

/* 住宅費：生活費とは別に計上 */
function housingCost(c, age) {
  const elapsed = Math.max(0, age - c.currentAge);

  if (c.housing === "rent") {
    return c.rentMonthly * 12 * Math.pow(1 + c.rentGrowth, elapsed);
  }

  const principal = mortgagePrincipal(c);
  const years = mortgageYears(c);
  const payment = loanAnnualPayment(principal, c.loanRate, years);
  const mortgage = principal > 0 && elapsed < years ? payment : 0;
  const inflationFactor = Math.pow(1 + c.inflation, elapsed);

  return mortgage + (c.homeTax + c.homeMaintenance) * inflationFactor;
}

function annualLiving(c, age, fireAge) {
  const base = age < fireAge ? c.preLiving : c.postLiving;
  return base * Math.pow(1 + c.inflation, Math.max(0, age - c.currentAge));
}
function annualPension(c, age) {
  if (age < c.pensionAge) return 0;

  return pensionNet(pensionGross(c)) *
    Math.pow(1 + c.inflation, Math.max(0, age - c.currentAge));
}
function annualSideIncome(c, age, fireAge) {
  if (age < fireAge || age > c.sideEndAge) return 0;
  return salaryNet(c.sideIncome);
}

/*
 * rateは、その年齢から次の年齢までの運用利回り。
 * 低迷期間はFIRE年齢からlowYears年間。
 */
function annualReturn(c, scenario, age, fireAge) {
  if (scenario === "basic") return c.baseReturn;
  if (scenario === "crash") return c.crashReturn;

  if (scenario === "low") {
    const lowEndAge = fireAge + c.lowYears;
    return age >= fireAge && age < lowEndAge
      ? c.lowReturn
      : c.lowAfterReturn;
  }

  return c.baseReturn;
}

/*
 * 年次の定義：
 * ・現在年齢の行は初期残高。運用益・収入・支出は発生させない。
 * ・各年齢から次の年齢までの1年間について運用と収支を計算する。
 * ・計算後の残高を次の年齢の行に記録する。
 * ・現金の予備費は翌年1年分の生活費＋住宅費。
 * ・支払い不能が起きた場合だけFIRE未達成とする。
 */
function runScenario(c, scenario, fireAge, stochasticRates = null) {
  let cash = c.cash;
  let investments = c.investments;
  let dc = c.dc;

  let firstShortageAge = null;
  let totalShortage = 0;
  const rows = [];

  // 新規購入費用は初期資産から一度だけ支払う
  if (c.housing === "buy" && c.homeStatus === "new") {
    const purchaseCosts = c.downPayment + c.homePrice * c.purchaseCostPct;

    const fromCash = Math.min(cash, purchaseCosts);
    cash -= fromCash;

    const remaining = purchaseCosts - fromCash;
    const fromInvestments = Math.min(investments, remaining);
    investments -= fromInvestments;

    // 通常はvalidateConfigで検出される。計算関数単体でも不正な購入を通さない。
    if (remaining - fromInvestments > EPSILON) {
      throw new Error("頭金と購入諸費用を現金・投資資産で支払えません。");
    }
  }

  // 現在年齢の行は初期残高のみ
  rows.push({
    age: c.currentAge,
    cash,
    investments,
    dc,
    totalAssets: cash + investments + dc,
    salary: 0,
    side: 0,
    pension: 0,
    income: 0,
    living: 0,
    housing: 0,
    expenses: 0,
    reserveTarget: 0,
    shortage: 0
  });

  // 現在年齢から終了年齢までの各1年間を計算
  for (let age = c.currentAge; age < c.lifeAge; age++) {
    const index = age - c.currentAge;
    const rate = stochasticRates
      ? stochasticRates[index]
      : annualReturn(c, scenario, age, fireAge);

    // 1年分の運用益を反映
    investments = Math.max(0, investments * (1 + rate));
    dc = Math.max(0, dc * (1 + rate));

    // 暴落は指定年齢から始まる1年間に一度だけ適用
    // 投資資産とDC・iDeCoの両方に同じ暴落率を適用する
    if (scenario === "crash" && age === c.crashAge) {
      investments = Math.max(0, investments * (1 + c.crashPct));
      dc = Math.max(0, dc * (1 + c.crashPct));
    }

    const salary = age < fireAge ? salaryNet(c.salary) : 0;
    const side = annualSideIncome(c, age, fireAge);
    const pension = annualPension(c, age);
    const income = salary + side + pension;

    cash += income;

    const living = annualLiving(c, age, fireAge);
    const housing = housingCost(c, age);
    const expenses = living + housing;

    cash -= expenses;

    let shortageThisYear = 0;

    // 支払い時の現金不足を投資資産、利用可能なDCの順に補う
    if (cash < 0) {
      let need = -cash;

      const fromInvestments = Math.min(investments, need);
      investments -= fromInvestments;
      need -= fromInvestments;

      if (need > EPSILON && age >= c.dcAge) {
        const fromDc = Math.min(dc, need);
        dc -= fromDc;
        need -= fromDc;
      }

      if (need > EPSILON) {
        shortageThisYear = need;
        totalShortage += need;

        if (firstShortageAge === null) firstShortageAge = age;
        cash = 0;
      } else {
        cash = 0;
      }
    }

    // 次の年齢時点で、翌年1年分の生活費＋住宅費を現金で確保する
    const nextAge = age + 1;
    const reserveTarget =
      annualLiving(c, nextAge, fireAge) + housingCost(c, nextAge);

    if (cash < reserveTarget) {
      let reserveNeed = reserveTarget - cash;

      const fromInvestments = Math.min(investments, reserveNeed);
      investments -= fromInvestments;
      cash += fromInvestments;
      reserveNeed -= fromInvestments;

      // 次の年齢でDCが利用可能になる場合に限って使用
      if (reserveNeed > EPSILON && nextAge >= c.dcAge) {
        const fromDc = Math.min(dc, reserveNeed);
        dc -= fromDc;
        cash += fromDc;
        reserveNeed -= fromDc;
      }
    }

    if (![cash, investments, dc].every(Number.isFinite)) {
      throw new Error("計算結果が数値の上限を超えました。入力値を見直してください。");
    }

    rows.push({
      age: nextAge,
      cash: Math.max(0, cash),
      investments: Math.max(0, investments),
      dc: Math.max(0, dc),
      totalAssets:
        Math.max(0, cash) + Math.max(0, investments) + Math.max(0, dc),
      salary,
      side,
      pension,
      income,
      living,
      housing,
      expenses,
      reserveTarget,
      shortage: shortageThisYear
    });
  }

  return {
    scenario,
    fireAge,
    rows,
    finalAssets: rows.length ? rows[rows.length - 1].totalAssets : 0,
    firstShortageAge,
    totalShortage,
    success: firstShortageAge === null
  };
}

function runAll(c, fireAge) {
  return {
    basic: runScenario(c, "basic", fireAge),
    crash: runScenario(c, "crash", fireAge),
    low: runScenario(c, "low", fireAge)
  };
}

function statusHTML(result) {
  return result.success
    ? '<span class="status ok">FIRE達成</span>'
    : '<span class="status ng">FIRE未達成</span>';
}

function renderSummary(results) {
  let html = '<div class="cards">';

  for (const key of ["basic", "crash", "low"]) {
    const result = results[key];

    html += `
      <div class="result-card">
        <h3>${SCENARIOS[key].name}</h3>
        <div style="margin:6px 0">${statusHTML(result)}</div>
        <div class="muted">終了年齢時点の資産</div>
        <div class="big-number">${money(result.finalAssets)}</div>
        <div class="result-line">
          最初の資産不足年齢：
          <strong>${result.firstShortageAge === null ? "なし" : result.firstShortageAge + "歳"}</strong>
        </div>
        <div class="result-line">
          支払い不足の累計：
          <strong>${money(result.totalShortage)}</strong>
        </div>
      </div>`;
  }

  html += "</div>";
  $("summary").innerHTML = html;
}

function renderTable(results) {
  const key = $("tableScenario").value;
  const result = results[key];

  let html = `<p class="muted">${SCENARIOS[key].name}のみ表示しています。</p>
    <table>
    <thead><tr>
      <th>年齢</th><th>現金</th><th>投資資産</th><th>DC・iDeCo</th>
      <th>総資産</th><th>給与手取り</th><th>追加収入</th><th>年金手取り</th>
      <th>生活費</th><th>住宅費</th><th>支払い不足</th>
    </tr></thead><tbody>`;

  for (const row of result.rows) {
    html += `<tr>
      <td>${row.age}歳</td>
      <td>${money(row.cash)}</td>
      <td>${money(row.investments)}</td>
      <td>${money(row.dc)}</td>
      <td><strong>${money(row.totalAssets)}</strong></td>
      <td>${money(row.salary)}</td>
      <td>${money(row.side)}</td>
      <td>${money(row.pension)}</td>
      <td>${money(row.living)}</td>
      <td>${money(row.housing)}</td>
      <td>${row.shortage > 0 ? money(row.shortage) : "—"}</td>
    </tr>`;
  }

  html += "</tbody></table>";
  $("annualTable").innerHTML = html;
  setAnnualTableCollapsed(true);
}

function setAnnualTableCollapsed(collapsed) {
  const table = $("annualTable");
  const button = $("annualTableToggle");
  if (!table || !button) return;

  table.classList.toggle("collapsed", collapsed);
  button.textContent = collapsed ? "続きを表示 ▼" : "折りたたむ ▲";
  button.setAttribute("aria-expanded", String(!collapsed));
}

function drawChart(results, c, fireAge) {
  const canvas = $("assetChart");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const pad = { left:60, right:12, top:18, bottom:34 };
  const plotW = Math.max(1, w - pad.left - pad.right);
  const plotH = Math.max(1, h - pad.top - pad.bottom);
  const values = ["basic", "crash", "low"].flatMap(key =>
    results[key].rows.map(row => row.totalAssets)
  );
  const maxValue = Math.max(1, ...values);
  const yMax = maxValue * 1.08;
  const minAge = c.currentAge, maxAge = c.lifeAge;
  const x = age => pad.left + (maxAge === minAge ? 0 : (age - minAge) / (maxAge - minAge)) * plotW;
  const y = value => pad.top + plotH - (value / yMax) * plotH;

  ctx.font = "11px sans-serif";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#e2e8f0";
  ctx.fillStyle = "#64748b";

  for (let i = 0; i <= 4; i++) {
    const value = yMax * i / 4, yy = y(value);
    ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(w - pad.right, yy); ctx.stroke();
    const label = value >= 10000
      ? (value / 10000).toFixed(1) + "億"
      : Math.round(value).toLocaleString("ja-JP");
    ctx.textAlign = "right"; ctx.fillText(label, pad.left - 7, yy + 4);
  }

  const ageStep = Math.max(5, Math.ceil((maxAge - minAge) / 8 / 5) * 5);
  for (let age = Math.ceil(minAge / ageStep) * ageStep; age <= maxAge; age += ageStep) {
    ctx.textAlign = "center"; ctx.fillText(String(age), x(age), h - 10);
  }

  const fireX = x(fireAge);
  ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = "#64748b";
  ctx.beginPath(); ctx.moveTo(fireX, pad.top); ctx.lineTo(fireX, pad.top + plotH); ctx.stroke();
  ctx.restore();

  ctx.textAlign = "left"; ctx.fillStyle = "#475569";
  ctx.fillText("FIRE " + fireAge + "歳", Math.min(fireX + 4, w - 75), pad.top + 12);

  for (const key of ["basic", "crash", "low"]) {
    const rows = results[key].rows;
    ctx.strokeStyle = SCENARIOS[key].color;
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    rows.forEach((row, index) => {
      if (index === 0) ctx.moveTo(x(row.age), y(row.totalAssets));
      else ctx.lineTo(x(row.age), y(row.totalAssets));
    });
    ctx.stroke();
  }
}

/* ---------- 確率シミュレーション ---------- */
function standardNormalRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function randomAnnualReturn(meanReturn, standardDeviation) {
  const meanGross = 1 + meanReturn;
  if (meanGross <= 0) {
    throw new Error("平均利回りは -100％ より大きい値にしてください。");
  }
  if (standardDeviation <= 0) return meanReturn;

  const varianceRatio = (standardDeviation / meanGross) ** 2;
  const sigmaLog = Math.sqrt(Math.log(1 + varianceRatio));
  const muLog = Math.log(meanGross) - (sigmaLog * sigmaLog) / 2;
  return Math.exp(muLog + sigmaLog * standardNormalRandom()) - 1;
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index), upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}
function median(values) {
  if (!values.length) return null;
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

function runMonteCarlo(c, trialCount, standardDeviation) {
  const terminalAssets = [];
  const failureAges = [];

  // 現在年齢は初期残高なので、リターンが発生するのは終了年齢までの年数分
  const periods = c.lifeAge - c.currentAge;
  const assetsByAge = Array.from({ length: periods + 1 }, () => []);
  let successCount = 0;

  for (let trial = 0; trial < trialCount; trial++) {
    const rates = new Array(periods);
    for (let i = 0; i < periods; i++) {
      rates[i] = randomAnnualReturn(c.baseReturn, standardDeviation);
    }

    const result = runScenario(c, "basic", c.fireAge, rates);
    terminalAssets.push(result.finalAssets);

    if (result.success) successCount++;
    else if (result.firstShortageAge !== null) failureAges.push(result.firstShortageAge);

    result.rows.forEach((row, index) => {
      assetsByAge[index].push(row.totalAssets);
    });
  }

  terminalAssets.sort((a, b) => a - b);
  failureAges.sort((a, b) => a - b);

  const distribution = assetsByAge.map((values, index) => {
    values.sort((a, b) => a - b);
    return {
      age: c.currentAge + index,
      p10: percentile(values, .10),
      median: percentile(values, .50),
      p90: percentile(values, .90)
    };
  });

  return {
    trialCount,
    successCount,
    failureCount: trialCount - successCount,
    successRate: successCount / trialCount,
    failureRate: (trialCount - successCount) / trialCount,
    medianFailureAge: median(failureAges),
    terminalMedian: percentile(terminalAssets, .50),
    terminalP10: percentile(terminalAssets, .10),
    terminalP5: percentile(terminalAssets, .05),
    standardDeviation,
    distribution
  };
}

function renderMonteCarlo(result) {
  const successPct = (result.successRate * 100).toFixed(1);
  const failurePct = (result.failureRate * 100).toFixed(1);
  const medianFailureText = result.medianFailureAge === null
    ? "資産不足なし"
    : Math.round(result.medianFailureAge) + "歳";

  $("mcResults").innerHTML = `
    <div class="notice">
      <strong>${result.trialCount.toLocaleString("ja-JP")}回の試行結果</strong><br>
      平均利回り：${(num("baseReturn")).toFixed(1)}％／年　
      標準偏差：${(result.standardDeviation * 100).toFixed(1)}％／年
    </div>
    <div class="probability-card" style="margin-top:12px">
      <div class="label">終了年齢まで資産が尽きない確率</div>
      <div class="value">${successPct}％</div>
      <div class="progress-track"><div class="progress-fill" style="width:${successPct}%"></div></div>
      <div class="result-line">
        達成：${result.successCount.toLocaleString("ja-JP")}回 ／
        未達成：${result.failureCount.toLocaleString("ja-JP")}回
      </div>
    </div>
    <div class="probability-grid">
      <div class="probability-card"><div class="label">資産不足になる確率</div><div class="value">${failurePct}％</div></div>
      <div class="probability-card"><div class="label">資産不足が起きた年齢の中央値</div><div class="value">${medianFailureText}</div></div>
      <div class="probability-card"><div class="label">終了年齢時点の資産・中央値</div><div class="value">${money(result.terminalMedian)}</div></div>
      <div class="probability-card"><div class="label">終了年齢時点の資産・下位10％</div><div class="value">${money(result.terminalP10)}</div></div>
      <div class="probability-card"><div class="label">終了年齢時点の資産・下位5％</div><div class="value">${money(result.terminalP5)}</div></div>
      <div class="probability-card"><div class="label">終了年齢</div><div class="value">${num("lifeAge")}歳</div></div>
    </div>
    <p class="help" style="margin-top:12px">
      「下位5％」は、試行結果を資産額の低い順に並べたときの5パーセンタイルです。
      終了時点の資産額は、資産不足が発生した試行も含めて集計しています。
      一度でも支払い不能になった試行は、後年に資産が回復しても未達成として数えます。
    </p>`;
  drawMonteCarloChart(result.distribution);
}

function drawMonteCarloChart(distribution) {
  const canvas = $("mcChart");
  if (!canvas || !distribution || !distribution.length) return;

  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const pad = { left:64, right:14, top:18, bottom:34 };
  const plotW = Math.max(1, w - pad.left - pad.right);
  const plotH = Math.max(1, h - pad.top - pad.bottom);
  const minAge = distribution[0].age;
  const maxAge = distribution[distribution.length - 1].age;
  const maxValue = Math.max(
    1,
    ...distribution.map(d => d.p90),
    ...distribution.map(d => d.median)
  );
  const yMax = maxValue * 1.08;
  const x = age => pad.left + (maxAge === minAge ? 0 : (age - minAge) / (maxAge - minAge)) * plotW;
  const y = value => pad.top + plotH - (value / yMax) * plotH;

  ctx.font = "11px sans-serif";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#e2e8f0";
  ctx.fillStyle = "#64748b";

  for (let i = 0; i <= 4; i++) {
    const value = yMax * i / 4, yy = y(value);
    ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(w - pad.right, yy); ctx.stroke();
    const label = value >= 10000
      ? (value / 10000).toFixed(1) + "億"
      : Math.round(value).toLocaleString("ja-JP");
    ctx.textAlign = "right"; ctx.fillText(label, pad.left - 7, yy + 4);
  }

  const ageStep = Math.max(5, Math.ceil((maxAge - minAge) / 8 / 5) * 5);
  for (let age = Math.ceil(minAge / ageStep) * ageStep; age <= maxAge; age += ageStep) {
    ctx.textAlign = "center"; ctx.fillText(String(age), x(age), h - 10);
  }

  ctx.beginPath();
  distribution.forEach((d, i) =>
    i === 0 ? ctx.moveTo(x(d.age), y(d.p90)) : ctx.lineTo(x(d.age), y(d.p90))
  );
  for (let i = distribution.length - 1; i >= 0; i--) {
    const d = distribution[i];
    ctx.lineTo(x(d.age), y(d.p10));
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(37,99,235,0.16)";
  ctx.fill();

  ctx.beginPath();
  distribution.forEach((d, i) =>
    i === 0 ? ctx.moveTo(x(d.age), y(d.median)) : ctx.lineTo(x(d.age), y(d.median))
  );
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const fireAge = clamp(num("fireAge"), minAge, maxAge);
  const fireX = x(fireAge);
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(fireX, pad.top); ctx.lineTo(fireX, pad.top + plotH); ctx.stroke();
  ctx.restore();

  ctx.textAlign = "left";
  ctx.fillStyle = "#475569";
  ctx.fillText("FIRE " + fireAge + "歳", Math.min(fireX + 4, w - 75), pad.top + 12);
  $("mcChartHelp").textContent =
    "試行回数：" + $("mcTrials").value + "回。帯は各年齢の資産額の下位10％〜上位90％、青線は中央値です。金額は万円単位です。";
}

function runMonteCarloAndRender() {
  const c = readConfig();
  if (!validateConfig(c)) return;

  const trials = Math.round(clamp(num("mcTrials"), 1000, 20000));
  const standardDeviation = num("mcStdDev") / 100;

  if (c.baseReturn <= -1) {
    alert("確率シミュレーションでは平均利回りを -100％ より大きい値にしてください。");
    return;
  }
  if (!Number.isFinite(standardDeviation) || standardDeviation < 0 || standardDeviation > 1) {
    alert("標準偏差は0〜100％の範囲で指定してください。");
    return;
  }

  const button = $("mcRunButton");
  button.disabled = true;
  button.textContent = "計算中…";

  setTimeout(() => {
    try {
      const result = runMonteCarlo(c, trials, standardDeviation);
      lastMonteCarloResult = result;
      renderMonteCarlo(result);
    } catch (error) {
      $("mcResults").innerHTML =
        `<p class="muted">計算できませんでした：${error.message}</p>`;
    } finally {
      button.disabled = false;
      button.textContent = "確率シミュレーションを実行";
    }
  }, 20);
}

/* ---------- 通常シミュレーション ---------- */
let lastConfig = null;
let lastResults = null;
let lastMonteCarloResult = null;

function updateHousingFields() {
  const rent = selectedHousing() === "rent";
  $("rentFields").classList.toggle("hidden", !rent);
  $("buyFields").classList.toggle("hidden", rent);

  const status = selectedHomeStatus();
  $("newHomeFields").classList.toggle("hidden", status !== "new");
  $("existingHomeFields").classList.toggle("hidden", status !== "existing");
}

function validateConfig(c) {
  if (c.lifeAge < c.currentAge) {
    alert("終了年齢は現在の年齢以上にしてください。");
    return false;
  }
  if (c.fireAge < c.currentAge || c.fireAge > c.lifeAge) {
    alert("FIRE年齢は現在の年齢から終了年齢までの範囲で指定してください。");
    return false;
  }

  const amounts = [
    ["現金", c.cash],
    ["投資資産", c.investments],
    ["DC・iDeCo資産", c.dc],
    ["年収", c.salary],
    ["年金額", c.pension65],
    ["FIRE前生活費", c.preLiving],
    ["FIRE後生活費", c.postLiving],
    ["追加収入", c.sideIncome],
    ["家賃", c.rentMonthly],
    ["住宅価格", c.homePrice],
    ["頭金", c.downPayment],
    ["現在の住宅ローン残高", c.currentLoanBalance],
    ["固定資産税", c.homeTax],
    ["修繕・維持費", c.homeMaintenance]
  ];

  for (const [label, value] of amounts) {
    if (!Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) {
      alert(`${label}は0〜${MAX_AMOUNT.toLocaleString("ja-JP")}万円の範囲で指定してください。`);
      return false;
    }
  }

  if (c.inflation <= -1 || c.inflation > 1 ||
      c.rentGrowth <= -1 || c.rentGrowth > 1) {
    alert("インフレ率・家賃上昇率は -100％超〜100％以下で指定してください。");
    return false;
  }

  const returns = [
    c.baseReturn, c.crashReturn, c.lowReturn, c.lowAfterReturn
  ];
  if (returns.some(r => !Number.isFinite(r) || r <= -1 || r > 5)) {
    alert("各運用利回りは -100％超〜500％以下で指定してください。");
    return false;
  }

  if (!Number.isFinite(c.loanRate) || c.loanRate < 0 || c.loanRate > 1) {
    alert("住宅ローン金利は0〜100％の範囲で指定してください。");
    return false;
  }

  if (c.crashPct < -1 || c.crashPct > 0 || !Number.isFinite(c.crashPct)) {
    alert("暴落率は -100％〜0％の範囲で指定してください。");
    return false;
  }

  if (c.lowYears < 0 || c.lowYears > 100) {
    alert("低迷期間は0〜100年の範囲で指定してください。");
    return false;
  }

  if (c.housing === "buy" && c.homeStatus === "new") {
    if (c.downPayment > c.homePrice) {
      alert("頭金は住宅価格以下にしてください。");
      return false;
    }
    if (c.purchaseCostPct < 0 || c.purchaseCostPct > 1) {
      alert("購入諸費用率は0〜100％の範囲で指定してください。");
      return false;
    }

    const principal = c.homePrice - c.downPayment;
    if (principal > 0 && (c.loanYears < 1 || c.loanYears > 50)) {
      alert("住宅ローンを借りる場合、返済期間は1〜50年にしてください。");
      return false;
    }

    const purchaseCosts = c.downPayment + c.homePrice * c.purchaseCostPct;
    const availableForPurchase = c.cash + c.investments;

    if (purchaseCosts > availableForPurchase + EPSILON) {
      const shortage = purchaseCosts - availableForPurchase;
      alert(
        "住宅購入に必要な頭金・諸費用が不足しています。\n" +
        `必要額：${money(purchaseCosts)}\n` +
        `現金＋投資資産：${money(availableForPurchase)}\n` +
        `不足額：${money(shortage)}\n\n` +
        "資産額・頭金・購入諸費用を見直してください。"
      );
      return false;
    }
  }

  if (c.housing === "buy" && c.homeStatus === "existing") {
    if (c.currentLoanBalance > 0 &&
        (c.remainingLoanYears < 1 || c.remainingLoanYears > 50)) {
      alert("ローン残高がある場合、残り返済年数は1〜50年にしてください。");
      return false;
    }
    if (c.currentLoanBalance === 0 && c.remainingLoanYears < 0) {
      alert("残り返済年数を確認してください。");
      return false;
    }
  }

  if (c.homeStatus === "new" && c.loanYears > 50) {
    alert("住宅ローン期間は50年以下にしてください。");
    return false;
  }

  // 入力値の組み合わせによる指数計算のオーバーフローを事前に検出
  try {
    const growthChecks = [
      Math.pow(1 + c.inflation, c.lifeAge - c.currentAge),
      Math.pow(1 + c.rentGrowth, c.lifeAge - c.currentAge),
      Math.pow(1 + Math.max(c.baseReturn, c.crashReturn, c.lowAfterReturn), c.lifeAge - c.currentAge)
    ];
    if (growthChecks.some(v => !Number.isFinite(v))) {
      alert("入力値の組み合わせで計算結果が上限を超えます。利回り・インフレ率を下げてください。");
      return false;
    }
  } catch {
    alert("入力値を確認してください。");
    return false;
  }

  return true;
}

function drawEmptyMonteCarloChart() {
  const canvas = $("mcChart");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    "確率シミュレーションを実行すると、ここにグラフが表示されます。",
    rect.width / 2,
    rect.height / 2
  );
}

function resetMonteCarloDisplay(message) {
  $("mcResults").innerHTML = `<p class="muted">${message}</p>`;
  lastMonteCarloResult = null;
  $("mcChartHelp").textContent =
    "設定が更新されました。新しい条件で確率シミュレーションを再実行してください。";
  drawEmptyMonteCarloChart();
}

function runAndRender() {
  const c = readConfig();
  if (!validateConfig(c)) return;

  try {
    const results = runAll(c, c.fireAge);

    lastConfig = c;
    lastResults = results;

    renderSummary(results);
    renderTable(results);
    drawChart(results, c, c.fireAge);

    $("reverseResult").textContent =
      "通常設定で" + c.fireAge + "歳でFIREした場合の結果を表示しています。";

    // 逆算用の初期値は通常設定から反映。
    // ユーザーが逆算条件を編集した場合はその値を維持する。
    if (!$("reverseInputsTouched").value) {
      $("reverseSideIncome").value = c.sideIncome;
      $("reverseSideEndAge").value = c.sideEndAge;
      $("reversePostLiving").value = c.postLiving;
    }

    resetMonteCarloDisplay(
      "設定が更新されました。新しい条件で「確率シミュレーションを実行」を押してください。"
    );
  } catch (error) {
    alert("計算できませんでした：" + error.message);
  }
}

function reverseFireAge() {
  const baseConfig = readConfig();
  if (!validateConfig(baseConfig)) return;

  const scenario = $("reverseScenario").value;
  const maxWorkAgeRaw = num("reverseMaxWorkAge");

  if (!Number.isFinite(maxWorkAgeRaw) ||
      maxWorkAgeRaw < baseConfig.currentAge ||
      maxWorkAgeRaw > baseConfig.lifeAge) {
    alert("逆算時の就労終了年齢の上限は、現在年齢以上・終了年齢以下にしてください。");
    return;
  }

  const maxWorkAge = Math.round(maxWorkAgeRaw);
  const reverseSideIncome = num("reverseSideIncome");
  const reversePostLiving = num("reversePostLiving");

  if (
    !Number.isFinite(reverseSideIncome) || reverseSideIncome < 0 ||
    reverseSideIncome > MAX_AMOUNT ||
    !Number.isFinite(reversePostLiving) || reversePostLiving < 0 ||
    reversePostLiving > MAX_AMOUNT
  ) {
    alert("逆算時の追加収入・生活費は0以上の適切な金額を入力してください。");
    return;
  }

  // 逆算専用の設定を作成。通常設定や通常結果には反映しない。
  const c = {
    ...baseConfig,
    sideIncome: reverseSideIncome,
    sideEndAge: Math.round(clamp(num("reverseSideEndAge"), 18, 120)),
    postLiving: reversePostLiving
  };

  let foundAge = null;
  let foundResult = null;

  try {
    for (let candidate = c.currentAge; candidate <= maxWorkAge; candidate++) {
      const result = runScenario(c, scenario, candidate);

      if (result.success) {
        foundAge = candidate;
        foundResult = result;
        break;
      }
    }
  } catch (error) {
    alert("逆算できませんでした：" + error.message);
    return;
  }

  if (foundAge === null) {
    $("reverseResult").innerHTML = `
      <strong>${SCENARIOS[scenario].name}では、${c.currentAge}歳から${maxWorkAge}歳までの範囲で、資産不足のないFIRE年齢が見つかりませんでした。</strong>
      <p class="muted">逆算条件の生活費・追加収入・就労終了年齢の上限、資産額、住宅費、運用利回りなどを見直してください。通常シミュレーションの結果は変更していません。</p>`;
    return;
  }

  $("reverseResult").innerHTML = `
    <div><strong>${SCENARIOS[scenario].name}での最短FIRE年齢：${foundAge}歳</strong></div>
    <div>現在からの就労年数：<strong>${foundAge - c.currentAge}年</strong></div>
    <div>逆算時の就労終了年齢の上限：<strong>${maxWorkAge}歳</strong></div>
    <div>逆算時のFIRE後追加収入：<strong>${money(c.sideIncome)}/年</strong></div>
    <div>追加収入の終了年齢：<strong>${c.sideEndAge}歳</strong></div>
    <div>逆算時のFIRE後生活費：<strong>${money(c.postLiving)}/年</strong></div>
    <div>終了年齢時点の資産：<strong>${money(foundResult.finalAssets)}</strong></div>
    <div>支払い不足：<strong>なし</strong></div>
    <p class="muted">この結果は逆算専用の条件で計算しています。通常のFIRE年齢入力欄・3シナリオの結果・通常グラフ・年次表は変更していません。通常設定との比較は、それぞれの結果を見比べてください。</p>`;
}

function resetDefaults() {
  const defaults = {
    currentAge:40, fireAge:45, lifeAge:90,
    cash:500, investments:500, dc:300, dcAge:60,
    inflation:2, baseReturn:4,
    salary:500, pension65:150, pensionAge:65,
    preLiving:300, postLiving:300, sideIncome:0, sideEndAge:60,
    rentMonthly:10, rentGrowth:1,
    homePrice:4000, downPayment:0, purchaseCostPct:5, loanYears:35,
    currentLoanBalance:2500, remainingLoanYears:25,
    loanRate:1.5, homeTax:15, homeMaintenance:15,
    crashPct:-30, crashAge:50, crashReturn:4,
    lowYears:5, lowReturn:0, lowAfterReturn:4,
    mcStdDev:15, mcTrials:10000,
    reverseMaxWorkAge:65, reverseSideIncome:0,
    reverseSideEndAge:60, reversePostLiving:300
  };

  for (const [id, value] of Object.entries(defaults)) {
    if ($(id)) $(id).value = value;
  }

  document.querySelector('input[name="housing"][value="rent"]').checked = true;
  document.querySelector('input[name="homeStatus"][value="new"]').checked = true;
  $("tableScenario").value = "basic";
  $("reverseScenario").value = "basic";
  $("reverseInputsTouched").value = "";

  updateHousingFields();
  runAndRender();
}

$("runButton").addEventListener("click", runAndRender);
$("resetButton").addEventListener("click", resetDefaults);
$("reverseButton").addEventListener("click", reverseFireAge);
$("mcRunButton").addEventListener("click", runMonteCarloAndRender);

$("tableScenario").addEventListener("change", () => {
  if (lastResults) renderTable(lastResults);
});

$("annualTableToggle").addEventListener("click", () => {
  const isCollapsed = $("annualTable").classList.contains("collapsed");
  setAnnualTableCollapsed(!isCollapsed);
});

document.querySelectorAll('input[name="housing"]').forEach(input => {
  input.addEventListener("change", updateHousingFields);
});
document.querySelectorAll('input[name="homeStatus"]').forEach(input => {
  input.addEventListener("change", updateHousingFields);
});

["reverseSideIncome", "reverseSideEndAge", "reversePostLiving"].forEach(id => {
  $(id).addEventListener("input", () => {
    $("reverseInputsTouched").value = "1";
  });
});

window.addEventListener("resize", () => {
  if (lastResults && lastConfig) {
    drawChart(lastResults, lastConfig, lastConfig.fireAge);
  }
  if (lastMonteCarloResult) {
    drawMonteCarloChart(lastMonteCarloResult.distribution);
  } else {
    drawEmptyMonteCarloChart();
  }
});

// 逆算条件をユーザーが編集したかどうかを管理する内部フラグ
const reverseTouchedInput = document.createElement("input");
reverseTouchedInput.type = "hidden";
reverseTouchedInput.id = "reverseInputsTouched";
reverseTouchedInput.value = "";
document.body.appendChild(reverseTouchedInput);

updateHousingFields();
runAndRender();

