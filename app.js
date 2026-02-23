const STORAGE_KEY = "couple-crowdfunding-state-v3";
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const COMPRESSED_TARGET_BYTES = 600 * 1024;
const MAX_IMAGE_EDGE = 1280;

// Supabaseを使う場合だけ値を入れてください
const SUPABASE_URL = "https://azaqiheyatryuioasnem.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_RUFNWbZMW2puDzUuEYgu8w_c1IOfGIA";

const state = {
  users: [],
  currentUserId: null,
  projects: [],
  history: [],
  roomId: null,
  hasSelectedUser: false
};

const runtime = {
  supabase: null,
  syncEnabled: false,
  applyingRemote: false,
  remoteSaveTimer: null,
  lastSyncedSignature: "",
  settingsOpen: false,
  createModalOpen: false
};

const els = {
  setupCard: document.getElementById("setupCard"),
  dashboard: document.getElementById("dashboard"),
  createProjectCard: document.getElementById("createProjectCard"),
  projectsCard: document.getElementById("projectsCard"),
  historyCard: document.getElementById("historyCard"),
  setupForm: document.getElementById("setupForm"),
  partnerOneName: document.getElementById("partnerOneName"),
  partnerTwoName: document.getElementById("partnerTwoName"),
  initialUser: document.getElementById("initialUser"),
  userSwitch: document.getElementById("userSwitch"),
  balances: document.getElementById("balances"),
  projectForm: document.getElementById("projectForm"),
  projectList: document.getElementById("projectList"),
  historyList: document.getElementById("historyList"),
  resetData: document.getElementById("resetData"),
  projectTemplate: document.getElementById("projectTemplate"),
  projectImage: document.getElementById("projectImage"),
  shareLink: document.getElementById("shareLink"),
  copyShareLink: document.getElementById("copyShareLink"),
  syncStatus: document.getElementById("syncStatus"),
  openSettings: document.getElementById("openSettings"),
  closeSettings: document.getElementById("closeSettings"),
  openCreateProject: document.getElementById("openCreateProject"),
  closeCreateProject: document.getElementById("closeCreateProject")
};

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createRoomId() {
  return Math.random().toString(36).slice(2, 10);
}

function normalizeImportedState(parsed) {
  if (!Array.isArray(parsed.users)) {
    return null;
  }

  if (parsed.users.length === 0) {
    return {
      users: [],
      currentUserId: null,
      projects: [],
      history: [],
      hasSelectedUser: false
    };
  }

  if (parsed.users.length !== 2) return null;

  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  projects.forEach((project) => {
    if (typeof project.reward !== "string") project.reward = "未設定";
    if (typeof project.rewardGiven !== "boolean") project.rewardGiven = false;
    if (typeof project.rewardReceived !== "boolean") project.rewardReceived = false;
    if (!Array.isArray(project.supporters)) project.supporters = [];
    if (!project.contributions || typeof project.contributions !== "object") project.contributions = {};
    if (!Array.isArray(project.rewardTiers)) {
      project.rewardTiers = project.reward
        ? [{ amount: 100, reward: project.reward }]
        : [{ amount: 100, reward: "お礼メッセージ" }];
    }
    if (typeof project.imageDataUrl !== "string") project.imageDataUrl = "";
  });

  return {
    users: parsed.users,
    currentUserId: parsed.currentUserId ?? parsed.users[0].id,
    projects,
    history: Array.isArray(parsed.history) ? parsed.history : [],
    hasSelectedUser:
      typeof parsed.hasSelectedUser === "boolean"
        ? parsed.hasSelectedUser
        : parsed.users.length === 2 && Boolean(parsed.currentUserId)
  };
}

function exportState() {
  return {
    users: state.users,
    currentUserId: state.currentUserId,
    projects: state.projects,
    history: state.history,
    hasSelectedUser: state.hasSelectedUser
  };
}

function applyImportedState(next) {
  state.users = next.users;
  state.currentUserId = next.currentUserId;
  state.projects = next.projects;
  state.history = next.history;
  state.hasSelectedUser = Boolean(next.hasSelectedUser);
  if (state.users.length === 2 && state.currentUserId) state.hasSelectedUser = true;
}

function loadLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeImportedState(parsed);
    if (!normalized) return;
    applyImportedState(normalized);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(exportState()));
}

function setSyncStatus(text) {
  if (!els.syncStatus) return;
  els.syncStatus.textContent = text;
}

function updateShareLink() {
  if (!els.shareLink) return;
  const room = state.roomId ?? "";
  const url = new URL(window.location.href);
  if (room) {
    url.searchParams.set("room", room);
  }
  els.shareLink.value = url.toString();
}

function currentSignature() {
  return JSON.stringify(exportState());
}

async function saveRemoteState() {
  if (!runtime.syncEnabled || !runtime.supabase || !state.roomId || runtime.applyingRemote) return;

  const payload = exportState();
  const signature = JSON.stringify(payload);
  if (signature === runtime.lastSyncedSignature) return;

  const { error } = await runtime.supabase.from("rooms").upsert(
    {
      room_id: state.roomId,
      state_json: payload,
      updated_at: new Date().toISOString()
    },
    { onConflict: "room_id" }
  );

  if (error) {
    setSyncStatus("同期エラー（ローカル保存は継続）");
    return;
  }

  runtime.lastSyncedSignature = signature;
  setSyncStatus("Supabase同期中");
}

function queueRemoteSave() {
  if (!runtime.syncEnabled) return;
  clearTimeout(runtime.remoteSaveTimer);
  runtime.remoteSaveTimer = setTimeout(() => {
    saveRemoteState();
  }, 350);
}

function saveState() {
  saveLocalState();
  queueRemoteSave();
}

async function fetchRemoteState() {
  if (!runtime.syncEnabled || !runtime.supabase || !state.roomId) return;

  const { data, error } = await runtime.supabase
    .from("rooms")
    .select("state_json")
    .eq("room_id", state.roomId)
    .maybeSingle();

  if (error) {
    setSyncStatus("同期準備中（テーブル設定待ち）");
    return;
  }

  if (!data?.state_json) {
    await saveRemoteState();
    return;
  }

  const normalized = normalizeImportedState(data.state_json);
  if (!normalized) return;

  runtime.applyingRemote = true;
  applyImportedState(normalized);
  runtime.lastSyncedSignature = JSON.stringify(exportState());
  saveLocalState();
  runtime.applyingRemote = false;
}

function subscribeRemote() {
  if (!runtime.syncEnabled || !runtime.supabase || !state.roomId) return;

  runtime.supabase
    .channel(`room-${state.roomId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "rooms",
        filter: `room_id=eq.${state.roomId}`
      },
      (payload) => {
        const next = payload?.new?.state_json;
        if (!next) return;

        const normalized = normalizeImportedState(next);
        if (!normalized) return;

        const incomingSignature = JSON.stringify(normalized);
        if (incomingSignature === runtime.lastSyncedSignature) return;

        runtime.applyingRemote = true;
        applyImportedState(normalized);
        runtime.lastSyncedSignature = JSON.stringify(exportState());
        saveLocalState();
        runtime.applyingRemote = false;
        renderAll();
      }
    )
    .subscribe();
}

async function initSupabaseSync() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || typeof window.supabase === "undefined") {
    runtime.syncEnabled = false;
    setSyncStatus("ローカルモード（Supabase未設定）");
    return;
  }

  runtime.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  runtime.syncEnabled = true;
  setSyncStatus("Supabase接続中...");

  await fetchRemoteState();
  subscribeRemote();
  setSyncStatus("Supabase同期中");
}

function formatPoints(value) {
  return `${Number(value).toLocaleString("ja-JP")} pt`;
}

function formatDate(isoDate) {
  if (!isoDate) return "未設定";

  const date = new Date(isoDate);
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function getThemeEmoji(theme) {
  const map = {
    business: "💼",
    "dream-challenge": "🚀",
    "beauty-healthcare": "🧴",
    fashion: "👗",
    "furniture-electronics": "🛋️",
    accessories: "🧩",
    travel: "✈️",
    "food-drink": "🍽️",
    music: "🎵",
    art: "🎨",
    "anime-manga-game": "🎮",
    cat: "🐱",
    dog: "🐶",
    both: "🐶🐱"
  };
  return map[theme] ?? "📌";
}

function getProjectStatus(project) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const deadline = new Date(project.deadline);
  deadline.setHours(0, 0, 0, 0);

  if (project.pledged >= project.target) {
    return { label: "達成", locked: true };
  }

  if (deadline < today) {
    return { label: "期限切れ", locked: true };
  }

  return { label: "募集中", locked: false };
}

function getRewardStateLabel(project) {
  if (project.pledged < project.target) return "🎁 お礼: 達成後に受け渡し";
  if (!project.rewardGiven) return "🎁 お礼: 受け渡し待ち";
  if (!project.rewardReceived) return "🎁 お礼: 受け取り確認待ち";
  return "🎁 お礼: 受け取り完了";
}

function getSupportTier(project, userId) {
  const total = Number(project.contributions?.[userId] ?? 0);
  const tiers = Array.isArray(project.rewardTiers) ? project.rewardTiers : [];
  const reached = tiers.filter((tier) => total >= tier.amount).sort((a, b) => b.amount - a.amount)[0];
  return { total, reached: reached ?? null };
}

function ensureReady() {
  const ready = state.users.length === 2;

  els.setupCard.hidden = ready;
  els.dashboard.hidden = !ready || !runtime.settingsOpen;
  els.createProjectCard.hidden = !ready || !runtime.createModalOpen;
  els.projectsCard.hidden = !ready;
  els.historyCard.hidden = !ready;
}

function renderSwitch() {
  els.userSwitch.innerHTML = "";

  state.users.forEach((user) => {
    const btn = document.createElement("button");
    const icon = user.id === "u1" ? "🐱" : "🐶";

    btn.type = "button";
    btn.textContent = `${icon} ${user.name}`;
    btn.classList.toggle("active", user.id === state.currentUserId);

    btn.addEventListener("click", () => {
      state.currentUserId = user.id;
      state.hasSelectedUser = true;
      runtime.settingsOpen = false;
      saveState();
      renderAll();
    });

    els.userSwitch.appendChild(btn);
  });
}

function renderBalances() {
  els.balances.innerHTML = "";

  state.users.forEach((user) => {
    const row = document.createElement("div");
    row.className = "balance-item";
    const icon = user.id === "u1" ? "🐱" : "🐶";
    row.innerHTML = `<strong>${icon} ${user.name}</strong><span>無制限</span>`;
    els.balances.appendChild(row);
  });
}

function updateProject(projectId, updater) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  updater(project);
  saveState();
  renderAll();
}

function renderProjects() {
  els.projectList.innerHTML = "";

  if (state.projects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "まだお願いがありません。最初のお願いを作ってみよう！";
    els.projectList.appendChild(empty);
    return;
  }

  const currentUser = state.users.find((user) => user.id === state.currentUserId);

  state.projects
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .forEach((project) => {
      const node = els.projectTemplate.content.cloneNode(true);
      const status = getProjectStatus(project);
      const owner = state.users.find((user) => user.id === project.ownerId);
      const article = node.querySelector(".project");
      const progress = Math.min(100, Math.round((project.pledged / project.target) * 100));

      node.querySelector(".pet").textContent = getThemeEmoji(project.theme);
      node.querySelector(".status").textContent = status.label;
      node.querySelector(".project-title").textContent = project.title;
      node.querySelector(".meta").textContent = `作成: ${owner?.name ?? "不明"} / 締切: ${formatDate(project.deadline)}`;
      node.querySelector(".desc").textContent = project.description;
      node.querySelector(".reward-state").textContent = getRewardStateLabel(project);
      node.querySelector(".progress").style.width = `${progress}%`;
      node.querySelector(".numbers").textContent = `${formatPoints(project.pledged)} / ${formatPoints(project.target)} (${progress}%)`;

      const tierList = node.querySelector(".tier-list");
      const currentTier = getSupportTier(project, state.currentUserId);
      (project.rewardTiers ?? [])
        .slice()
        .sort((a, b) => a.amount - b.amount)
        .forEach((tier) => {
          const li = document.createElement("li");
          if (currentTier.total >= tier.amount) li.classList.add("reached");
          li.textContent = `${formatPoints(tier.amount)}: ${tier.reward}`;
          tierList.appendChild(li);
        });

      const imageEl = node.querySelector(".project-image");
      if (project.imageDataUrl) {
        imageEl.src = project.imageDataUrl;
        imageEl.hidden = false;
      }

      const actionBtn = node.querySelector(".reward-action");
      if (project.pledged >= project.target) {
        if (state.currentUserId === project.ownerId && !project.rewardGiven) {
          actionBtn.hidden = false;
          actionBtn.textContent = "お礼を渡した";
          actionBtn.addEventListener("click", () => {
            updateProject(project.id, (draft) => {
              draft.rewardGiven = true;
            });
          });
        } else if (
          state.currentUserId !== project.ownerId &&
          project.rewardGiven &&
          !project.rewardReceived &&
          Array.isArray(project.supporters) &&
          project.supporters.includes(state.currentUserId)
        ) {
          actionBtn.hidden = false;
          actionBtn.textContent = "お礼を受け取った";
          actionBtn.addEventListener("click", () => {
            updateProject(project.id, (draft) => {
              draft.rewardReceived = true;
            });
          });
        }
      }

      const form = node.querySelector(".support-form");
      const input = form.querySelector("input");
      const button = form.querySelector("button");

      if (status.locked || !currentUser) {
        input.disabled = true;
        button.disabled = true;
      }

      if (project.ownerId === state.currentUserId) {
        input.disabled = true;
        button.disabled = true;
        button.textContent = "自分のお願い";
      }

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const amount = Number(input.value);

        if (!Number.isFinite(amount) || amount < 100 || amount % 100 !== 0) {
          alert("100ポイント単位で入力してください。");
          return;
        }

        supportProject(project.id, amount);
      });

      article.dataset.id = project.id;
      els.projectList.appendChild(node);
    });
}

function renderHistory() {
  els.historyList.innerHTML = "";

  if (state.history.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "まだ応援履歴がありません。";
    els.historyList.appendChild(empty);
    return;
  }

  state.history.slice(0, 20).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.date} | ${item.fromName} が ${item.projectTitle} に ${formatPoints(item.amount)} 応援 (到達リターン: ${item.tier ?? "なし"})`;
    els.historyList.appendChild(li);
  });
}

function renderAll() {
  ensureReady();
  updateShareLink();

  if (state.users.length !== 2) return;

  renderSwitch();
  renderBalances();
  renderProjects();
  renderHistory();
}

function createUsers(name1, name2, initialUserId) {
  state.users = [
    { id: "u1", name: name1.trim() },
    { id: "u2", name: name2.trim() }
  ];
  state.currentUserId = initialUserId === "u2" ? "u2" : "u1";
  state.projects = [];
  state.history = [];
  state.hasSelectedUser = true;
  runtime.settingsOpen = false;
  runtime.createModalOpen = false;
}

function launchConfetti() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  document.body.appendChild(canvas);

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();

  const colors = ["#ff8a6d", "#ffd37a", "#92d7c7", "#7fb3ff", "#ffb4d4", "#ffe27d", "#8ee0ff"];
  const pieces = Array.from({ length: 260 }).map(() => ({
    x: Math.random() * canvas.width,
    y: -40 - Math.random() * canvas.height * 0.45,
    vx: (Math.random() - 0.5) * 3.8,
    vy: 2 + Math.random() * 4.2,
    size: 4 + Math.random() * 8,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.35,
    color: colors[Math.floor(Math.random() * colors.length)]
  }));

  const start = performance.now();
  const duration = 4200;

  function frame(now) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    pieces.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.vy += 0.03;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });

    if (elapsed < duration) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }

  requestAnimationFrame(frame);
}

function supportProject(projectId, amount) {
  const project = state.projects.find((item) => item.id === projectId);
  const fromUser = state.users.find((user) => user.id === state.currentUserId);

  if (!project || !fromUser) return;

  const status = getProjectStatus(project);
  if (status.locked) {
    alert("このお願いには応援できません。");
    return;
  }

  if (fromUser.id === project.ownerId) {
    alert("自分のお願いには応援できません。");
    return;
  }

  project.pledged += amount;
  if (!project.supporters.includes(fromUser.id)) {
    project.supporters.push(fromUser.id);
  }
  if (!project.contributions || typeof project.contributions !== "object") {
    project.contributions = {};
  }
  project.contributions[fromUser.id] = Number(project.contributions[fromUser.id] ?? 0) + amount;

  const date = new Date().toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  state.history.unshift({
    id: uid("hist"),
    date,
    fromName: fromUser.name,
    projectTitle: project.title,
    amount,
    tier: getSupportTier(project, fromUser.id).reached?.reward ?? "なし"
  });

  if (project.pledged >= project.target) {
    const owner = state.users.find((u) => u.id === project.ownerId);
    launchConfetti();
    alert(`🎉 ${project.title} が達成しました！\n${owner?.name ?? "パートナー"}はお礼を準備しましょう。`);
  }

  saveState();
  renderAll();
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("画像の読み込みに失敗しました。"));
    };
    img.src = objectUrl;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("画像変換に失敗しました。"));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("画像圧縮に失敗しました。"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

async function compressImage(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選んでください。");
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("画像サイズは8MB以下にしてください。");
  }

  const img = await loadImageElement(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像処理に失敗しました。");

  ctx.drawImage(img, 0, 0, width, height);

  let quality = 0.86;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > COMPRESSED_TARGET_BYTES && quality > 0.5) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, quality);
  }

  const dataUrl = await blobToDataUrl(blob);
  return {
    dataUrl,
    compressedBytes: blob.size,
    originalBytes: file.size
  };
}

if (els.copyShareLink) {
  els.copyShareLink.addEventListener("click", async () => {
    if (!els.shareLink?.value) return;

    try {
      await navigator.clipboard.writeText(els.shareLink.value);
      setSyncStatus(runtime.syncEnabled ? "リンクをコピーしました（Supabase同期中）" : "リンクをコピーしました（ローカルモード）");
    } catch {
      els.shareLink.select();
      document.execCommand("copy");
      setSyncStatus("リンクをコピーしました");
    }
  });
}

if (els.openSettings) {
  els.openSettings.addEventListener("click", () => {
    if (state.users.length !== 2) return;
    runtime.settingsOpen = !runtime.settingsOpen;
    if (els.dashboard) els.dashboard.hidden = !runtime.settingsOpen;
    renderAll();
  });
}

if (els.closeSettings) {
  els.closeSettings.addEventListener("click", () => {
    runtime.settingsOpen = false;
    if (els.dashboard) els.dashboard.hidden = true;
    renderAll();
  });
}

if (els.openCreateProject) {
  els.openCreateProject.addEventListener("click", () => {
    runtime.createModalOpen = true;
    renderAll();
  });
}

if (els.closeCreateProject) {
  els.closeCreateProject.addEventListener("click", () => {
    runtime.createModalOpen = false;
    renderAll();
  });
}

if (els.setupForm) {
  els.setupForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name1 = els.partnerOneName.value;
  const name2 = els.partnerTwoName.value;
  const initialUser = els.initialUser.value;

  if (!name1.trim() || !name2.trim()) {
    alert("名前を入力してください。");
    return;
  }

  if (name1.trim() === name2.trim()) {
    alert("同じ名前は使えません。");
    return;
  }

    createUsers(name1, name2, initialUser);
    saveState();
    renderAll();
  });
}

if (els.projectForm) {
  els.projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  if (!currentUser) return;

  const title = document.getElementById("title").value.trim();
  const target = Number(document.getElementById("target").value);
  const deadline = document.getElementById("deadline").value;
  const theme = document.getElementById("theme").value;
  const description = document.getElementById("description").value.trim();
  const imageFile = els.projectImage.files?.[0];
  const tier1Amount = Number(document.getElementById("tier1Amount").value);
  const tier1Reward = document.getElementById("tier1Reward").value.trim();
  const tier2AmountRaw = document.getElementById("tier2Amount").value;
  const tier2Reward = document.getElementById("tier2Reward").value.trim();
  const tier3AmountRaw = document.getElementById("tier3Amount").value;
  const tier3Reward = document.getElementById("tier3Reward").value.trim();

  if (!title || !description || !deadline || !tier1Reward) {
    alert("未入力の項目があります。");
    return;
  }

  if (!Number.isFinite(target) || target < 100) {
    alert("目標ポイントは100以上で入力してください。");
    return;
  }

  if (!Number.isFinite(tier1Amount) || tier1Amount < 100 || tier1Amount % 100 !== 0) {
    alert("しきい値1は100ポイント単位で入力してください。");
    return;
  }

  const rewardTiers = [{ amount: tier1Amount, reward: tier1Reward }];
  if (tier2AmountRaw || tier2Reward) {
    const tier2Amount = Number(tier2AmountRaw);
    if (!Number.isFinite(tier2Amount) || tier2Amount < 100 || tier2Amount % 100 !== 0 || !tier2Reward) {
      alert("段階2はしきい値とリターンをセットで正しく入力してください。");
      return;
    }
    rewardTiers.push({ amount: tier2Amount, reward: tier2Reward });
  }
  if (tier3AmountRaw || tier3Reward) {
    const tier3Amount = Number(tier3AmountRaw);
    if (!Number.isFinite(tier3Amount) || tier3Amount < 100 || tier3Amount % 100 !== 0 || !tier3Reward) {
      alert("段階3はしきい値とリターンをセットで正しく入力してください。");
      return;
    }
    rewardTiers.push({ amount: tier3Amount, reward: tier3Reward });
  }

  rewardTiers.sort((a, b) => a.amount - b.amount);
  for (let i = 1; i < rewardTiers.length; i += 1) {
    if (rewardTiers[i - 1].amount >= rewardTiers[i].amount) {
      alert("しきい値は小さい順に重複なしで設定してください。");
      return;
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(deadline);
  due.setHours(0, 0, 0, 0);

  if (due < today) {
    alert("締切日は今日以降を選んでください。");
    return;
  }

  let imageDataUrl = "";
  if (imageFile) {
    try {
      const compressed = await compressImage(imageFile);
      imageDataUrl = compressed.dataUrl;
    } catch (error) {
      alert(error.message);
      return;
    }
  }

  state.projects.push({
    id: uid("proj"),
    ownerId: currentUser.id,
    title,
    target,
    deadline,
    theme,
    reward: rewardTiers[0].reward,
    rewardTiers,
    description,
    imageDataUrl,
    rewardGiven: false,
    rewardReceived: false,
    supporters: [],
    contributions: {},
    pledged: 0,
    createdAt: new Date().toISOString()
  });

    els.projectForm.reset();
    runtime.createModalOpen = false;
    saveState();
    renderAll();
  });
}

if (els.resetData) {
  els.resetData.addEventListener("click", () => {
    const ok = confirm("すべてのデータを消して初期化します。よろしいですか？");
    if (!ok) return;

    localStorage.removeItem(STORAGE_KEY);
    state.users = [];
    state.currentUserId = null;
    state.projects = [];
    state.history = [];
    state.hasSelectedUser = false;
    runtime.settingsOpen = false;
    runtime.createModalOpen = false;
    if (els.setupForm) els.setupForm.reset();
    saveState();
    renderAll();
  });
}

async function boot() {
  const roomInUrl = new URL(window.location.href).searchParams.get("room");
  state.roomId = roomInUrl || createRoomId();

  if (!roomInUrl) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("room", state.roomId);
    window.history.replaceState({}, "", nextUrl);
  }

  loadLocalState();
  runtime.settingsOpen = false;
  runtime.createModalOpen = false;
  renderAll();
  runtime.lastSyncedSignature = currentSignature();
  await initSupabaseSync();
  renderAll();
}

boot();
