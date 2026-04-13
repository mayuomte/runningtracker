import { useState, useEffect, useCallback, useRef } from "react";

/*
  RUN REWARDS — Point System Tracker with Screenshot Import
  Rules: 10pts/km, +10 new PR, 1.2× tough, milestones at 5/7.5/10km,
  streak bonuses, reward tiers Bronze→Diamond
*/

const REWARDS = [
  { tier: "Bronze", cost: 50, emoji: "🥉", examples: "Fancy coffee, protein smoothie, or small snack", color: "#cd7f32" },
  { tier: "Silver", cost: 120, emoji: "🥈", examples: "A nice meal out or a new book/manga", color: "#a8a8a8" },
  { tier: "Gold", cost: 300, emoji: "🥇", examples: "Movie ticket + snacks or new workout apparel", color: "#f0c548" },
  { tier: "Platinum", cost: 600, emoji: "💎", examples: "New running shoes or high-quality earbuds", color: "#7ec8e3" },
  { tier: "Diamond", cost: 1200, emoji: "✨", examples: "A major splurge — tech, trips, or big gear", color: "#c084fc" },
];

const STREAK_BONUSES = [0, 0, 5, 10, 15, 20];
function getStreakBonus(wk) { return wk >= 5 ? 20 : (STREAK_BONUSES[wk] || 0); }

function getMilestoneBonus(km) {
  let b = 0;
  if (km >= 5) b += 15;
  if (km >= 7.5) b += 25;
  if (km >= 10) b += 40;
  return b;
}

function getWeekKey(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const m = new Date(d); m.setDate(diff);
  return m.toISOString().slice(0, 10);
}

function calculateStreakWeek(runs) {
  if (!runs.length) return 1;
  const wc = {};
  runs.forEach(r => { const w = getWeekKey(r.date); wc[w] = (wc[w] || 0) + 1; });
  const weeks = Object.keys(wc).sort().reverse();
  let s = 0;
  for (const w of weeks) { if (wc[w] >= 2) s++; else break; }
  return Math.max(1, s);
}

function getPersonalRecord(runs) {
  return runs.length ? Math.max(...runs.map(r => r.distance)) : 0;
}

function calculateRunPoints(distance, isTough, currentPR, streakWeek) {
  const base = Math.round(distance * 10);
  const milestone = getMilestoneBonus(distance);
  const newTerritory = distance > currentPR ? 10 : 0;
  const streakBonus = getStreakBonus(streakWeek);
  const subtotal = base + milestone + newTerritory + streakBonus;
  const multiplier = isTough ? 1.2 : 1.0;
  const total = Math.round(subtotal * multiplier);
  return { base, milestone, newTerritory, streakBonus, multiplier, total };
}

function formatDateShort(d) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function loadData() {
  try { const r = await window.storage.get("runrewards-v3"); if (r) return JSON.parse(r.value); } catch {}
  return { runs: [], redeemed: [] };
}
async function saveData(data) {
  try { await window.storage.set("runrewards-v3", JSON.stringify(data)); } catch (e) { console.error(e); }
}

// ─── Screenshot parser via Claude API ───
async function parseScreenshot(base64, mediaType) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 }
            },
            {
              type: "text",
              text: `You are analyzing a running app screenshot (Nike Run Club, Strava, or similar).
Extract the following data and return ONLY a JSON object with no markdown, no backticks, no explanation:
{
  "distance_km": <number in kilometers, convert from miles if needed>,
  "duration": "<string like '25:30' or '1:02:15'>",
  "avg_pace": "<string like '5:30 /km' or null if not found>",
  "calories": <number or null if not found>,
  "elevation": "<string or null if not found>",
  "avg_heart_rate": <number or null if not found>,
  "source": "<'Nike Run Club' or 'Strava' or 'Unknown'>"
}
If the distance is in miles, convert to km (multiply by 1.60934).
If you cannot read the image clearly, return: {"error": "Could not read screenshot"}`
            }
          ]
        }]
      })
    });
    const data = await res.json();
    const text = data.content?.map(b => b.text || "").join("") || "";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("Parse error:", e);
    return { error: "Failed to analyze screenshot" };
  }
}

// ─── Components ───

function Toast({ message }) {
  if (!message) return null;
  return (
    <div style={{
      position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
      background: "rgba(0,0,0,0.82)", color: "#fff", padding: "12px 24px",
      borderRadius: 100, fontSize: 14, fontWeight: 600, zIndex: 999,
      animation: "toastPop 0.35s cubic-bezier(.34,1.56,.64,1)",
      backdropFilter: "blur(20px)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)"
    }}>{message}</div>
  );
}

function StatPill({ emoji, value, label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, padding: "14px 4px" }}>
      <span style={{ fontSize: 20, marginBottom: 4 }}>{emoji}</span>
      <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--text)" }}>{value}</span>
      <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500, marginTop: 2 }}>{label}</span>
    </div>
  );
}

function TabBar({ tab, setTab }) {
  const tabs = [
    { id: "log", label: "Log", icon: "🏃" },
    { id: "shop", label: "Shop", icon: "🎁" },
    { id: "history", label: "History", icon: "📋" },
    { id: "rules", label: "Rules", icon: "📖" },
  ];
  return (
    <div style={{ display: "flex", gap: 4, padding: "4px", background: "var(--surface-elevated)", borderRadius: 14, margin: "0 0 8px 0" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{
          flex: 1, padding: "10px 6px", border: "none", borderRadius: 11,
          background: tab === t.id ? "var(--surface-card)" : "transparent",
          color: tab === t.id ? "var(--text)" : "var(--text-secondary)",
          fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s ease",
          boxShadow: tab === t.id ? "0 1px 4px rgba(0,0,0,0.06)" : "none",
          fontFamily: "inherit", letterSpacing: "-0.01em",
        }}>
          <span style={{ marginRight: 4 }}>{t.icon}</span>{t.label}
        </button>
      ))}
    </div>
  );
}

function PointBreakdown({ breakdown }) {
  if (!breakdown) return null;
  const rows = [
    { label: "Base", value: `${breakdown.base}`, show: true },
    { label: "Milestone", value: `+${breakdown.milestone}`, show: breakdown.milestone > 0 },
    { label: "New Record!", value: `+${breakdown.newTerritory}`, show: breakdown.newTerritory > 0 },
    { label: "Streak", value: `+${breakdown.streakBonus}`, show: breakdown.streakBonus > 0 },
    { label: "Tough ×1.2", value: "applied", show: breakdown.multiplier > 1 },
  ];
  return (
    <div style={{ background: "var(--surface-elevated)", borderRadius: 14, padding: "14px 16px", marginTop: 12, animation: "fadeSlide 0.3s ease" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Point Preview
      </div>
      {rows.filter(r => r.show).map((r, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14, color: "var(--text)" }}>
          <span style={{ fontWeight: 500 }}>{r.label}</span>
          <span style={{ fontWeight: 600, color: "var(--accent)" }}>{r.value}</span>
        </div>
      ))}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 16 }}>
        <span style={{ fontWeight: 700 }}>Total</span>
        <span style={{ fontWeight: 800, color: "var(--accent)" }}>{breakdown.total} pts</span>
      </div>
    </div>
  );
}

// ─── Scan Result Card ───
function ScanResult({ scanData, onConfirm, onCancel, isTough, setIsTough, preview }) {
  return (
    <div style={{ animation: "fadeSlide 0.3s ease" }}>
      <div style={{
        background: "linear-gradient(135deg, rgba(0,122,255,0.08), rgba(0,122,255,0.03))",
        border: "1px solid rgba(0,122,255,0.15)",
        borderRadius: 16, padding: "16px 18px", marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 20 }}>📸</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Screenshot Detected</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>from {scanData.source || "running app"}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            { label: "Distance", value: `${scanData.distance_km?.toFixed(2)} km`, icon: "📏" },
            { label: "Duration", value: scanData.duration || "—", icon: "⏱️" },
            { label: "Avg Pace", value: scanData.avg_pace || "—", icon: "🏃" },
            { label: "Calories", value: scanData.calories ? `${scanData.calories} kcal` : "—", icon: "🔥" },
            ...(scanData.elevation ? [{ label: "Elevation", value: scanData.elevation, icon: "⛰️" }] : []),
            ...(scanData.avg_heart_rate ? [{ label: "Avg HR", value: `${scanData.avg_heart_rate} bpm`, icon: "❤️" }] : []),
          ].map((s, i) => (
            <div key={i} style={{
              background: "var(--surface-card)", borderRadius: 12, padding: "10px 12px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500, marginBottom: 2 }}>
                {s.icon} {s.label}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => setIsTough(!isTough)}
        style={{
          width: "100%", padding: "12px", border: "none", borderRadius: 12,
          fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          marginBottom: 8, transition: "all 0.2s ease",
          background: isTough ? "var(--accent)" : "var(--surface-elevated)",
          color: isTough ? "#fff" : "var(--text-secondary)",
        }}
      >
        💪 Tough conditions {isTough ? "(1.2× active)" : ""}
      </button>

      <PointBreakdown breakdown={preview} />

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={onCancel} style={{
          flex: 1, padding: "14px", border: "none", borderRadius: 14,
          fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          background: "var(--surface-elevated)", color: "var(--text-secondary)",
        }}>
          Cancel
        </button>
        <button onClick={onConfirm} style={{
          flex: 2, padding: "14px", border: "none", borderRadius: 14,
          fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          background: "var(--accent)", color: "#fff",
        }}>
          Log This Run
        </button>
      </div>
    </div>
  );
}

// ─── Main App ───
export default function RunRewards() {
  const [runs, setRuns] = useState([]);
  const [redeemed, setRedeemed] = useState([]);
  const [tab, setTab] = useState("log");
  const [distance, setDistance] = useState("");
  const [isTough, setIsTough] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanData, setScanData] = useState(null);
  const [scanPreview, setScanPreview] = useState(null);
  const toastTimer = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    loadData().then(d => { setRuns(d.runs || []); setRedeemed(d.redeemed || []); setLoading(false); });
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  const save = useCallback((nr, nd) => saveData({ runs: nr, redeemed: nd }), []);

  const totalEarned = runs.reduce((s, r) => s + r.points, 0);
  const totalSpent = redeemed.reduce((s, r) => s + r.cost, 0);
  const balance = totalEarned - totalSpent;
  const pr = getPersonalRecord(runs);
  const streakWeek = calculateStreakWeek(runs);
  const totalKm = runs.reduce((s, r) => s + r.distance, 0);
  const dist = parseFloat(distance) || 0;
  const preview = dist > 0 ? calculateRunPoints(dist, isTough, pr, streakWeek) : null;

  // Update scan preview when tough toggles
  useEffect(() => {
    if (scanData && scanData.distance_km > 0) {
      setScanPreview(calculateRunPoints(scanData.distance_km, isTough, pr, streakWeek));
    }
  }, [scanData, isTough, pr, streakWeek]);

  const logRun = (d, tough, extraStats) => {
    if (d <= 0 || d > 200) return;
    const pts = calculateRunPoints(d, tough, pr, streakWeek);
    const run = {
      id: Date.now(), date: new Date().toISOString(),
      distance: d, points: pts.total, isTough: tough,
      isNewRecord: d > pr, breakdown: pts,
      ...(extraStats || {}),
    };
    const nr = [run, ...runs];
    setRuns(nr); save(nr, redeemed);
    setDistance(""); setIsTough(false); setScanData(null); setScanPreview(null);
    showToast(`🎉 +${pts.total} points earned!`);
  };

  const handleManualLog = () => logRun(dist, isTough);

  const handleScanConfirm = () => {
    if (!scanData) return;
    const extra = {};
    if (scanData.duration) extra.duration = scanData.duration;
    if (scanData.avg_pace) extra.avgPace = scanData.avg_pace;
    if (scanData.calories) extra.calories = scanData.calories;
    if (scanData.elevation) extra.elevation = scanData.elevation;
    if (scanData.avg_heart_rate) extra.avgHR = scanData.avg_heart_rate;
    if (scanData.source) extra.source = scanData.source;
    logRun(scanData.distance_km, isTough, extra);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setScanning(true);
    setScanData(null);

    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Read failed"));
        r.readAsDataURL(file);
      });

      const mediaType = file.type || "image/jpeg";
      const result = await parseScreenshot(base64, mediaType);

      if (result.error) {
        showToast(`⚠️ ${result.error}`);
        setScanning(false);
        return;
      }

      if (!result.distance_km || result.distance_km <= 0) {
        showToast("⚠️ Couldn't find distance in screenshot");
        setScanning(false);
        return;
      }

      result.distance_km = Math.round(result.distance_km * 100) / 100;
      setScanData(result);
      setScanPreview(calculateRunPoints(result.distance_km, isTough, pr, streakWeek));
    } catch (err) {
      showToast("⚠️ Failed to read screenshot");
      console.error(err);
    }
    setScanning(false);
  };

  const redeemReward = (reward) => {
    if (balance < reward.cost) return;
    const entry = { ...reward, id: Date.now(), date: new Date().toISOString() };
    const nd = [entry, ...redeemed];
    setRedeemed(nd); save(runs, nd);
    showToast(`${reward.emoji} Redeemed: ${reward.tier}!`);
  };

  const deleteRun = (id) => {
    const nr = runs.filter(r => r.id !== id);
    setRuns(nr); save(nr, redeemed);
    showToast("Run removed");
  };

  const resetAll = () => {
    if (confirm("Reset all data? This cannot be undone.")) {
      setRuns([]); setRedeemed([]); save([], []);
      showToast("All data cleared");
    }
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif" }}>
      <span style={{ fontSize: 32 }}>🏃</span>
    </div>
  );

  return (
    <div style={S.container}>
      <style>{cssText}</style>
      <Toast message={toast} />
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileUpload} />

      {/* Header */}
      <div style={S.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h1 style={S.title}>Run Rewards</h1>
            <p style={S.subtitle}>Every kilometre counts</p>
          </div>
          <button onClick={resetAll} style={S.resetBtn}>Reset</button>
        </div>
        <div style={S.balanceCard}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-secondary)", marginBottom: 4 }}>
            Available Balance
          </div>
          <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--text)", lineHeight: 1.1 }}>
            {balance}<span style={{ fontSize: 18, fontWeight: 600, color: "var(--text-secondary)", marginLeft: 4 }}>pts</span>
          </div>
        </div>
        <div style={S.statsRow}>
          <StatPill emoji="🏃" value={runs.length} label="Runs" />
          <StatPill emoji="📏" value={`${totalKm.toFixed(1)}`} label="Total km" />
          <StatPill emoji="🔥" value={`Wk ${streakWeek}`} label="Streak" />
          <StatPill emoji="🏅" value={pr > 0 ? `${pr}km` : "—"} label="PR" />
        </div>
        {streakWeek >= 2 && (
          <div style={S.streakBanner}>🔥 Week {streakWeek} streak — +{getStreakBonus(streakWeek)} bonus pts per run!</div>
        )}
      </div>

      <TabBar tab={tab} setTab={setTab} />

      {/* ── LOG TAB ── */}
      {tab === "log" && (
        <div style={S.card}>
          {/* Mode switcher: Screenshot upload vs manual */}
          {!scanData && !scanning && (
            <>
              {/* Screenshot upload area */}
              <button
                onClick={() => fileRef.current?.click()}
                style={S.uploadArea}
              >
                <div style={{ fontSize: 36, marginBottom: 8 }}>📸</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text)", marginBottom: 4 }}>
                  Upload Screenshot
                </div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                  Nike Run Club, Strava, or any running app
                </div>
              </button>

              <div style={S.divider}>
                <div style={S.dividerLine} />
                <span style={S.dividerText}>or enter manually</span>
                <div style={S.dividerLine} />
              </div>

              <div style={S.inputRow}>
                <div style={S.inputWrap}>
                  <input
                    type="number" value={distance}
                    onChange={e => setDistance(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleManualLog()}
                    placeholder="0.0" step="0.1" min="0" style={S.input}
                  />
                  <span style={S.inputUnit}>km</span>
                </div>
              </div>

              <button
                onClick={() => setIsTough(!isTough)}
                style={{
                  ...S.toggleBtn,
                  background: isTough ? "var(--accent)" : "var(--surface-elevated)",
                  color: isTough ? "#fff" : "var(--text-secondary)",
                }}
              >
                💪 Tough conditions {isTough ? "(1.2× active)" : ""}
              </button>

              <PointBreakdown breakdown={preview} />

              <button
                onClick={handleManualLog}
                disabled={dist <= 0}
                style={{ ...S.primaryBtn, opacity: dist <= 0 ? 0.4 : 1, cursor: dist <= 0 ? "default" : "pointer" }}
              >
                Log Run
              </button>
            </>
          )}

          {/* Scanning state */}
          {scanning && (
            <div style={{ textAlign: "center", padding: "40px 0", animation: "fadeSlide 0.3s ease" }}>
              <div style={{ fontSize: 40, marginBottom: 12, animation: "pulse 1.2s ease-in-out infinite" }}>📸</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text)", marginBottom: 4 }}>
                Analyzing screenshot...
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                Reading your run data with AI
              </div>
            </div>
          )}

          {/* Scan result */}
          {scanData && !scanning && (
            <ScanResult
              scanData={scanData}
              onConfirm={handleScanConfirm}
              onCancel={() => { setScanData(null); setScanPreview(null); }}
              isTough={isTough}
              setIsTough={setIsTough}
              preview={scanPreview}
            />
          )}
        </div>
      )}

      {/* ── SHOP TAB ── */}
      {tab === "shop" && (
        <div>
          {REWARDS.map((r, i) => {
            const canAfford = balance >= r.cost;
            const progress = Math.min(100, (balance / r.cost) * 100);
            return (
              <div key={i} style={{ ...S.card, marginBottom: 8, animation: `fadeSlide 0.3s ease ${i * 0.06}s both` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 28 }}>{r.emoji}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{r.tier}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.3 }}>{r.examples}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontWeight: 800, fontSize: 18, color: "var(--text)" }}>{r.cost}</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>pts</div>
                  </div>
                </div>
                <div style={S.progressTrack}>
                  <div style={{ ...S.progressFill, width: `${progress}%`, background: canAfford ? "var(--accent)" : r.color }} />
                </div>
                <button
                  onClick={() => redeemReward(r)}
                  disabled={!canAfford}
                  style={{
                    ...S.redeemBtn,
                    background: canAfford ? "var(--accent)" : "var(--surface-elevated)",
                    color: canAfford ? "#fff" : "var(--text-secondary)",
                    cursor: canAfford ? "pointer" : "default", opacity: canAfford ? 1 : 0.5,
                  }}
                >
                  {canAfford ? "Redeem" : `Need ${r.cost - balance} more pts`}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── HISTORY TAB ── */}
      {tab === "history" && (
        <div>
          {redeemed.length > 0 && (
            <>
              <div style={S.sectionLabel}>Redeemed</div>
              {redeemed.map((r, i) => (
                <div key={r.id} style={{ ...S.historyRow, animation: `fadeSlide 0.25s ease ${i * 0.04}s both` }}>
                  <span style={{ fontSize: 22 }}>{r.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{r.tier}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{formatDateShort(r.date)}</div>
                  </div>
                  <span style={{ fontWeight: 700, color: "#e05252", fontSize: 14 }}>−{r.cost}</span>
                </div>
              ))}
            </>
          )}

          <div style={S.sectionLabel}>Runs</div>
          {runs.length === 0 && (
            <div style={{ ...S.card, textAlign: "center", color: "var(--text-secondary)", padding: 32 }}>
              No runs logged yet. Get out there! 🏃
            </div>
          )}
          {runs.map((r, i) => (
            <div key={r.id} style={{ ...S.historyRow, animation: `fadeSlide 0.25s ease ${i * 0.04}s both` }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                background: r.isNewRecord ? "linear-gradient(135deg, #f0c548, #e8a735)" : "var(--surface-elevated)",
                fontSize: 18, flexShrink: 0,
              }}>
                {r.source ? "📸" : r.isNewRecord ? "🏅" : "🏃"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
                  {r.distance} km
                  {r.isTough && <span style={{ fontSize: 11, color: "var(--accent)", marginLeft: 6 }}>💪 1.2×</span>}
                  {r.isNewRecord && <span style={{ fontSize: 11, color: "#e8a735", marginLeft: 6 }}>NEW PR</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {formatDateShort(r.date)}
                  {r.duration && <span> · {r.duration}</span>}
                  {r.avgPace && <span> · {r.avgPace}</span>}
                  {r.source && <span> · {r.source}</span>}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontWeight: 700, color: "var(--accent)", fontSize: 14 }}>+{r.points}</div>
                <button onClick={() => deleteRun(r.id)} style={S.deleteBtn}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── RULES TAB ── */}
      {tab === "rules" && (
        <div>
          <div style={S.card}>
            <div style={S.cardTitle}>1. Base Points</div>
            <div style={S.ruleText}><strong>10 pts</strong> per km — your 2.5km run = 25 pts.</div>
            <div style={{ ...S.ruleText, marginTop: 8 }}><strong>+10 pts</strong> "New Territory" bonus when you beat your personal record.</div>
            <div style={{ ...S.ruleText, marginTop: 8 }}><strong>×1.2</strong> multiplier for tough conditions (early AM, rain, long day).</div>
          </div>
          <div style={{ ...S.card, marginTop: 8 }}>
            <div style={S.cardTitle}>2. Milestone Bonuses</div>
            {[["5.0 km", "+15 pts", "= 65 total"], ["7.5 km", "+25 pts", "= 100 total"], ["10.0 km", "+40 pts", "= 140 total"]].map(([d, b, t], i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < 2 ? "1px solid var(--border)" : "none", fontSize: 14, alignItems: "center" }}>
                <span style={{ fontWeight: 600, color: "var(--text)", flex: 1 }}>{d}</span>
                <span style={{ color: "var(--accent)", fontWeight: 700, flex: 1, textAlign: "center" }}>{b}</span>
                <span style={{ color: "var(--text-secondary)", fontSize: 12, flex: 1, textAlign: "right" }}>{t}</span>
              </div>
            ))}
          </div>
          <div style={{ ...S.card, marginTop: 8 }}>
            <div style={S.cardTitle}>3. Streak System</div>
            <div style={{ ...S.ruleText, marginBottom: 10 }}>Run 2+ times per week to build your streak.</div>
            {[["Week 1", "Base only"], ["Week 2", "+5 per run"], ["Week 3", "+10 per run"], ["Week 4", "+15 per run"], ["Week 5+", "+20 per run (cap)"]].map(([w, b], i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14, borderBottom: i < 4 ? "1px solid var(--border)" : "none" }}>
                <span style={{ fontWeight: 600, color: "var(--text)" }}>{w}</span>
                <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{b}</span>
              </div>
            ))}
            <div style={{ ...S.ruleText, marginTop: 12, color: "#e05252", fontWeight: 600, fontSize: 13, background: "rgba(224,82,82,0.08)", padding: "10px 12px", borderRadius: 10 }}>
              ⚠️ Fewer than 2 runs in a week → streak resets to Week 1!
            </div>
          </div>
          <div style={{ ...S.card, marginTop: 8 }}>
            <div style={S.cardTitle}>4. Reward Shop</div>
            {REWARDS.map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < REWARDS.length - 1 ? "1px solid var(--border)" : "none", fontSize: 14, alignItems: "center" }}>
                <span>{r.emoji} <strong>{r.tier}</strong></span>
                <span style={{ fontWeight: 700, color: "var(--accent)" }}>{r.cost} pts</span>
              </div>
            ))}
            <div style={{ ...S.ruleText, marginTop: 12, fontWeight: 600, fontSize: 13 }}>
              No debt allowed — you must have the points first!
            </div>
          </div>
        </div>
      )}

      <div style={{ height: 24 }} />
    </div>
  );
}

// ─── CSS ───
const cssText = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800&display=swap');
  :root {
    --bg: #f2f2f7; --surface-card: #ffffff; --surface-elevated: #e5e5ea;
    --text: #1c1c1e; --text-secondary: #8e8e93; --accent: #007aff;
    --border: rgba(0,0,0,0.06); --radius: 16px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #000000; --surface-card: #1c1c1e; --surface-elevated: #2c2c2e;
      --text: #f5f5f7; --text-secondary: #8e8e93; --accent: #0a84ff;
      --border: rgba(255,255,255,0.08);
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); }
  input:focus { outline: none; }
  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type="number"] { -moz-appearance: textfield; }
  @keyframes toastPop {
    from { opacity: 0; transform: translateX(-50%) translateY(16px) scale(0.95); }
    to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  }
  @keyframes fadeSlide {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.15); }
  }
`;

// ─── Styles ───
const S = {
  container: {
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    maxWidth: 480, margin: "0 auto", padding: "0 8px",
    minHeight: "100vh", background: "var(--bg)", color: "var(--text)",
    WebkitFontSmoothing: "antialiased",
  },
  header: { paddingTop: 20, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--text)", lineHeight: 1.1 },
  subtitle: { fontSize: 14, color: "var(--text-secondary)", fontWeight: 500, marginTop: 2 },
  resetBtn: {
    background: "var(--surface-elevated)", border: "none", borderRadius: 10,
    padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)",
    cursor: "pointer", fontFamily: "inherit",
  },
  balanceCard: {
    background: "var(--surface-card)", borderRadius: "var(--radius)",
    padding: "20px 20px 18px", marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  statsRow: {
    display: "flex", background: "var(--surface-card)", borderRadius: "var(--radius)",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)", overflow: "hidden",
  },
  streakBanner: {
    marginTop: 10, padding: "10px 14px",
    background: "linear-gradient(135deg, #ff9500, #ff6b00)", borderRadius: 12,
    fontSize: 13, fontWeight: 700, color: "#fff", textAlign: "center",
  },
  card: {
    background: "var(--surface-card)", borderRadius: "var(--radius)",
    padding: "18px 18px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  cardTitle: { fontSize: 17, fontWeight: 700, color: "var(--text)", marginBottom: 14, letterSpacing: "-0.02em" },
  uploadArea: {
    width: "100%", padding: "28px 16px", border: "2px dashed var(--border)",
    borderRadius: 16, background: "var(--surface-elevated)", cursor: "pointer",
    fontFamily: "inherit", textAlign: "center", transition: "all 0.2s ease",
    marginBottom: 0,
  },
  divider: {
    display: "flex", alignItems: "center", gap: 12, margin: "16px 0",
  },
  dividerLine: { flex: 1, height: 1, background: "var(--border)" },
  dividerText: { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" },
  inputRow: { display: "flex", gap: 10 },
  inputWrap: { position: "relative", flex: 1 },
  input: {
    width: "100%", padding: "14px 48px 14px 16px", fontSize: 28, fontWeight: 700,
    fontFamily: "inherit", background: "var(--surface-elevated)", border: "none",
    borderRadius: 14, color: "var(--text)", letterSpacing: "-0.03em",
  },
  inputUnit: {
    position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)",
    fontSize: 16, fontWeight: 600, color: "var(--text-secondary)",
  },
  toggleBtn: {
    width: "100%", padding: "12px", border: "none", borderRadius: 12,
    fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    marginTop: 10, transition: "all 0.2s ease",
  },
  primaryBtn: {
    width: "100%", padding: "16px", border: "none", borderRadius: 14,
    fontSize: 16, fontWeight: 700, background: "var(--accent)", color: "#fff",
    cursor: "pointer", fontFamily: "inherit", marginTop: 14, transition: "opacity 0.2s",
  },
  progressTrack: {
    width: "100%", height: 5, background: "var(--surface-elevated)",
    borderRadius: 100, overflow: "hidden", marginBottom: 10,
  },
  progressFill: { height: "100%", borderRadius: 100, transition: "width 0.4s ease" },
  redeemBtn: {
    width: "100%", padding: "10px", border: "none", borderRadius: 10,
    fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
    transition: "all 0.2s ease",
  },
  sectionLabel: {
    fontSize: 12, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.06em", color: "var(--text-secondary)", padding: "12px 4px 8px",
  },
  historyRow: {
    display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
    background: "var(--surface-card)", borderRadius: 14, marginBottom: 6,
    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
  },
  deleteBtn: {
    background: "none", border: "none", color: "var(--text-secondary)",
    fontSize: 12, cursor: "pointer", padding: "2px 4px", fontFamily: "inherit", opacity: 0.5,
  },
  ruleText: { fontSize: 14, color: "var(--text)", lineHeight: 1.5, fontWeight: 400 },
};
