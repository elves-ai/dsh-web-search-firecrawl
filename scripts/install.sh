#!/usr/bin/env bash
# =============================================================================
# @pionai/dsh-web-search-firecrawl 一键安装脚本
# （官方 CLI 方式，macOS / Linux / Windows Git Bash）
#
# 通过 DSH 官方插件命令安装 npm 包并自动挂载：
#   dsh plugin --profile web add @pionai/dsh-web-search-firecrawl@<version>
#
# 包内声明了 dsh.bundle.patch（cordis.patch.yml）与 dsh.client（lib/client.js）：
# CLI 会把 bundle 自动加进 profile 的 dsh.profile.bundles，下次启动即挂载
# Host 搜索提供方与设置页的 Firecrawl 配置页面。
#
# 用法：
#   bash scripts/install.sh [版本] [--restart] [--dry-run]
#
#   版本        npm 版本号/范围，缺省为 latest（自动解析为最新版）。
#   --restart   装完后尝试 `pm2 restart dsh-web`（无 pm2 时仅打印提示）。
#   --dry-run   只打印将要执行的操作，不写任何文件。
#   -h/--help   打印本帮助。
#
# 环境（均可省略，脚本会自动探测）：
#   DSH_HOME    默认 ~/.dsh（Windows Git Bash 下回退 $USERPROFILE/.dsh）
#   REGISTRY    默认 https://registry.npmjs.org
#   DSH_CMD     默认优先用 PATH 上的 `dsh`，缺省回退 npx -y --package @deepseek-ai/dsh
# =============================================================================
set -euo pipefail

PKG="@pionai/dsh-web-search-firecrawl"

for arg in "$@"; do
  if [ "$arg" = "-h" ] || [ "$arg" = "--help" ]; then
    cat <<'HELP'
Firecrawl Web Search 一键安装脚本

用法：bash scripts/install.sh [版本] [--restart] [--dry-run]

  版本         npm 版本号/范围，缺省 latest（自动解析为最新）。示例：0.1.1、^0.1.1、latest
  --restart    装完后尝试 `pm2 restart dsh-web`（无 pm2 时仅提示）
  --dry-run    只打印将要执行的操作，不写任何文件

环境变量（可省略）：DSH_HOME（默认 ~/.dsh）、REGISTRY（npm 源）、DSH_CMD（dsh 命令）
HELP
    exit 0
  fi
done

if [ -n "${DSH_HOME:-}" ]; then
  :
elif [ -n "${HOME:-}" ]; then
  DSH_HOME="$HOME/.dsh"
elif [ -n "${USERPROFILE:-}" ]; then
  DSH_HOME="$USERPROFILE/.dsh"
else
  echo "[error] 无法确定 home 目录，请设置 DSH_HOME。" >&2
  exit 1
fi

PROFILE_DIR="$DSH_HOME/profiles/web"
WS_YML="$PROFILE_DIR/pnpm-workspace.yaml"
PATCH_YML="$PROFILE_DIR/cordis.patch.yml"
REGISTRY="${REGISTRY:-https://registry.npmjs.org}"
DSH_CMD="${DSH_CMD:-}"

RESTART=false
DRY_RUN=false
VERSION_SPEC=""
for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=true ;;
    --dry-run) DRY_RUN=true ;;
    -h|--help) : ;;
    -*) echo "未知参数: ${arg}（用 -h 查看用法）" >&2; exit 2 ;;
    *) VERSION_SPEC="$arg" ;;
  esac
done

say()  { printf '\033[32m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# 解析用户给的版本 -> CLI 要用的 npm spec（"x.y.z" / "^x.y.z" / latest）
resolve_spec() {
  local given="${1:-latest}"
  case "$given" in
    latest)
      local v=""
      if command -v npm >/dev/null 2>&1; then
        v="$(npm view "$PKG" version --registry="$REGISTRY" 2>/dev/null)" || v=""
      fi
      if [ -z "$v" ] && command -v pnpm >/dev/null 2>&1; then
        v="$(pnpm view "$PKG" version --registry="$REGISTRY" 2>/dev/null)" || v=""
      fi
      if [ -n "$v" ]; then
        printf '%s' "$v"
      else
        warn "无法联网解析最新版本，回退为 latest，由 pnpm 直接解析。"
        warn "若已知版本号，可显式传入：bash scripts/install.sh 0.1.1"
        printf 'latest'
      fi
      ;;
    *) printf '%s' "$given" ;;
  esac
}

# 组装 dsh CLI 调用：优先 DSH_CMD / PATH 上的 dsh，缺省 npx 拉官方包
dsh_cli() {
  if [ -n "$DSH_CMD" ]; then
    printf '%s' "$DSH_CMD"
  elif command -v dsh >/dev/null 2>&1; then
    printf 'dsh'
  elif command -v npx >/dev/null 2>&1; then
    printf 'npx -y --package @deepseek-ai/dsh dsh'
  else
    die "未找到 dsh 或 npx。请先安装 DSH（并确保 Node/npm 可用），或用 DSH_CMD 指定 dsh 路径。"
  fi
}

# 前置校验
command -v node >/dev/null 2>&1 || die "未找到 node（DSH 运行需要 Node.js ≥ 22），请先安装 Node.js 并加入 PATH。"
command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm。dsh plugin 通过 pnpm 安装插件，请先安装 pnpm 并加入 PATH。"
[ -d "$PROFILE_DIR" ] || die "找不到 profile 目录：${PROFILE_DIR}（请先安装并运行过一次 dsh web）"
[ -f "$WS_YML" ]      || die "找不到 ${WS_YML}（请先初始化 web profile）"

SPEC="$(resolve_spec "$VERSION_SPEC")"
CLI="$(dsh_cli)"
say "目标：$CLI plugin --profile web add $PKG@${SPEC}（profile: ${PROFILE_DIR}）"

if [ "$DRY_RUN" = true ]; then
  say "[dry-run] 步骤 1：确保 $WS_YML 的 minimumReleaseAgeExclude 包含 $PKG"
  say "[dry-run] 步骤 2：执行 $CLI plugin --profile web add $PKG@${SPEC}（安装 + bundle 自动注册）"
  say "[dry-run] 步骤 3：校验 dsh.profile.bundles 含 $PKG"
  say "[dry-run] 步骤 4：幂等移除 $PATCH_YML 里旧的 web-search-firecrawl 手动挂载行（避免双挂载）"
  if [ "$RESTART" = true ]; then say "[dry-run] 步骤 5：pm2 restart dsh-web"; else say "[dry-run] 步骤 5：提示用户手动重启 DSH"; fi
  exit 0
fi

# 步骤 1：预写 minimumReleaseAgeExclude，放行本插件刚发布 <24h 的新版本。
WS_RESULT="$(node -e '
const fs = require("fs");
const p = process.argv[1];
const pkg = process.argv[2];
let t = fs.readFileSync(p, "utf8");
const before = t;
const q = String.fromCharCode(39);
const quoted = "  - " + q + pkg + q;
const hasEntry = t.split(/\r?\n/).some((line) => {
  const v = line.trim();
  return v === "- " + q + pkg + q || v === "- " + pkg
    || v.startsWith("- " + q + pkg + "@") || v.startsWith("- " + pkg + "@");
});
if (!hasEntry) {
  if (/^\s*minimumReleaseAgeExclude:\s*$/m.test(t)) {
    t = t.replace(/^(\s*minimumReleaseAgeExclude:\s*)$/m, "$1\n" + quoted);
  } else {
    t += (t.endsWith("\n") ? "" : "\n") + "\nminimumReleaseAgeExclude:\n" + quoted + "\n";
  }
}
if (t !== before) fs.writeFileSync(p, t);
console.log(t === before ? "unchanged" : "updated");
' "$WS_YML" "$PKG")"
[ "$WS_RESULT" = "updated" ] \
  && say "已确保 ${WS_YML}：minimumReleaseAgeExclude 包含 ${PKG}" \
  || say "workspace 设置已就绪，跳过"

# 步骤 2：官方 CLI 安装 + bundle 自动注册（含挂载）
say "执行 $CLI plugin --profile web add $PKG@$SPEC ..."
if ! $CLI plugin --profile web add "$PKG@$SPEC" 2>&1; then
  warn "dsh plugin add 失败。可能原因："
  warn "  - 网络/登录问题：npm registry 不可达或需要登录。"
  warn "  - 依赖安装冲突：可手动重试 cd $PROFILE_DIR && pnpm install -w。"
  exit 1
fi

# 步骤 3：校验 bundle 已注册（挂载生效的判据）
if ! node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bundles = p.dsh?.profile?.bundles ?? [];
  process.exit(bundles.includes(process.argv[2]) ? 0 : 1);
' "$PROFILE_DIR/package.json" "$PKG"; then
  warn "$PKG 未出现在 dsh.profile.bundles 中——挂载未注册。"
  warn "请确认包已发布且 manifest 中声明了 dsh.bundle.patch 后重跑本脚本。"
  exit 1
fi
say "bundle 已注册：dsh.profile.bundles 包含 ${PKG}（下次启动自动挂载）"

# 步骤 4：幂等移除旧的 manual 挂载行（避免与 bundle 双挂载）
if [ -f "$PATCH_YML" ]; then
  MOUNT_RESULT="$(node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const lines = fs.readFileSync(p, "utf8").split("\n");
  const out = [];
  let i = 0;
  let removed = false;
  while (i < lines.length) {
    const line = lines[i];
    if (/^[ \t]*- insert:\s*$/.test(line)) {
      const block = [line];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "" && !/^-\s/.test(lines[j])) {
        block.push(lines[j]);
        j++;
      }
      if (block.some((l) => /id:\s*web-search-firecrawl\s*(?:#.*)?$/.test(l.trim()))) {
        while (out.length && /^[ \t]*#/.test(out[out.length - 1])) out.pop();
        i = j;
        removed = true;
        continue;
      }
    }
    out.push(line);
    i++;
  }
  if (!removed) {
    console.log("none");
  } else {
    const t = out.join("\n").replace(/\n{3,}/g, "\n\n");
    fs.writeFileSync(p, t);
    console.log("removed");
  }
  ' "$PATCH_YML")"
  [ "$MOUNT_RESULT" = "removed" ] \
    && say "已从 $PATCH_YML 移除旧的 web-search-firecrawl 手动挂载行（bundle 通道接管挂载）" \
    || say "无旧手动挂载行，跳过"
else
  say "profile 尚未生成 cordis.patch.yml，跳过旧挂载清理"
fi

say "安装完成：$PKG@$SPEC"

# 步骤 5：重启提示
if [ "$RESTART" = true ]; then
  if command -v pm2 >/dev/null 2>&1; then
    say "重启 dsh-web（pm2）..."
    pm2 restart dsh-web || warn "pm2 restart 失败，请手动重启 DSH"
  else
    warn "未找到 pm2，请手动重启 DSH（如：pm2 restart dsh-web 或 dsh web）"
  fi
else
  say "下一步：重启 DSH 并硬刷新（Cmd/Ctrl+Shift+R）使新副本与设置页生效。"
  if command -v pm2 >/dev/null 2>&1; then
    say "本机可用：pm2 restart dsh-web（会短暂断开当前页面会话）"
  fi
fi
