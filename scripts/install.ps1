# =============================================================================
# @pionai/dsh-web-search-firecrawl 一键安装脚本
# （官方 CLI 方式，Windows PowerShell 5.1+ / pwsh）
#
# 通过 DSH 官方插件命令安装 npm 包并自动挂载：
#   dsh plugin --profile web add @pionai/dsh-web-search-firecrawl@<version>
#
# 包内声明了 dsh.bundle.patch（cordis.patch.yml）与 dsh.client（lib/client.js）：
# CLI 会把 bundle 自动加进 profile 的 dsh.profile.bundles，下次启动即挂载
# Host 搜索提供方与设置页的 Firecrawl 配置页面。
#
# 用法：
#   irm https://raw.githubusercontent.com/PionAI/dsh-web-search-firecrawl/refs/heads/master/scripts/install.ps1 | iex
#   & ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/PionAI/dsh-web-search-firecrawl/refs/heads/master/scripts/install.ps1'))) -Version 0.1.2 -Restart
#
# 参数：
#   -Version    npm 版本号/范围，缺省 latest（自动解析为最新）。
#   -Restart    装完后尝试 `pm2 restart dsh-web`（无 pm2 时仅提示）。
#   -DryRun     只打印将要执行的操作，不写任何文件。
# =============================================================================
param(
  [string]$Version = '',
  [switch]$Restart,
  [switch]$DryRun
)

$PKG = '@pionai/dsh-web-search-firecrawl'
$REGISTRY = if ($env:REGISTRY) { $env:REGISTRY } else { 'https://registry.npmjs.org' }

if ($env:DSH_HOME) {
  $DSH_HOME = $env:DSH_HOME
} elseif ($env:USERPROFILE) {
  $DSH_HOME = Join-Path $env:USERPROFILE '.dsh'
} else {
  $DSH_HOME = Join-Path $HOME '.dsh'
}
$PROFILE_DIR = Join-Path $DSH_HOME 'profiles\web'
$WS_YML = Join-Path $PROFILE_DIR 'pnpm-workspace.yaml'
$PATCH_YML = Join-Path $PROFILE_DIR 'cordis.patch.yml'

function Say([string]$m)  { Write-Host "[install] $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "[warn] $m" -ForegroundColor Yellow }
function Die([string]$m)  { Write-Host "[error] $m" -ForegroundColor Red; exit 1 }

function Resolve-Spec {
  param([string]$Given)
  if ([string]::IsNullOrWhiteSpace($Given) -or $Given -eq 'latest') {
    $v = $null
    foreach ($tool in @('npm', 'pnpm')) {
      if (Get-Command $tool -ErrorAction SilentlyContinue) {
        $v = (& $tool view $PKG version "--registry=$REGISTRY" 2>$null | Select-Object -Last 1)
        if ($v) { break }
      }
    }
    if ($v) { return ([string]$v).Trim() }
    Warn '无法联网解析最新版本，回退为 latest，由 pnpm 直接解析。'
    Warn '若已知版本号，可显式传入：-Version 0.1.2'
    return 'latest'
  }
  return $Given
}

function Get-DshInvocation {
  if ($env:DSH_CMD) { return [PSCustomObject]@{ Command = $env:DSH_CMD; UseNpx = $false } }
  if (Get-Command dsh -ErrorAction SilentlyContinue) { return [PSCustomObject]@{ Command = 'dsh'; UseNpx = $false } }
  if (Get-Command npx -ErrorAction SilentlyContinue) { return [PSCustomObject]@{ Command = 'npx'; UseNpx = $true } }
  return $null
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die '未找到 node（DSH 运行需要 Node.js >= 22），请先安装 Node.js 并加入 PATH。'
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Die '未找到 pnpm。dsh plugin 通过 pnpm 安装插件，请先安装 pnpm 并加入 PATH。'
}
if (-not (Test-Path $PROFILE_DIR)) {
  Die "找不到 profile 目录：$PROFILE_DIR（请先安装并运行过一次 dsh web）"
}
if (-not (Test-Path $WS_YML)) {
  Die "找不到 $WS_YML（请先初始化 web profile）"
}

$SPEC = Resolve-Spec $Version
$INV = Get-DshInvocation
if (-not $INV) {
  Die '未找到 dsh 或 npx。请先安装 DSH，或用 DSH_CMD 指定。'
}
Say "目标：$($INV.Command) plugin --profile web add $PKG@$SPEC（profile: $PROFILE_DIR）"

if ($DryRun) {
  Say "[dry-run] 步骤 1：确保 $WS_YML 的 minimumReleaseAgeExclude 包含 $PKG"
  Say "[dry-run] 步骤 2：执行 $($INV.Command) plugin --profile web add $PKG@$SPEC（安装 + bundle 自动注册）"
  Say "[dry-run] 步骤 3：校验 dsh.profile.bundles 含 $PKG"
  Say "[dry-run] 步骤 4：幂等移除 $PATCH_YML 里旧的 web-search-firecrawl 手动挂载行（避免双挂载）"
  if ($Restart) { Say '[dry-run] 步骤 5：pm2 restart dsh-web' } else { Say '[dry-run] 步骤 5：提示用户手动重启 DSH' }
  exit 0
}

# 步骤 1：预写 minimumReleaseAgeExclude（幂等），放行刚发布 <24h 的新版本
$wsScript = @'
const fs = require("fs");
const p = process.argv[2];
const pkg = process.argv[3];
let t = fs.readFileSync(p, "utf8");
const before = t;
const quoted = "  - '" + pkg + "'";
const hasEntry = t.split(/\r?\n/).some((line) => {
  const v = line.trim();
  return v === "- '" + pkg + "'" || v === "- " + pkg
    || v.startsWith("- '" + pkg + "@") || v.startsWith("- " + pkg + "@");
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
'@
$wsJs = Join-Path $env:TEMP ("dshfc-ws-" + [guid]::NewGuid().ToString("N") + ".js")
Set-Content -LiteralPath $wsJs -Value $wsScript -Encoding UTF8
$wsOut = node $wsJs "$WS_YML" "$PKG" 2>&1
$wsCode = $LASTEXITCODE
Remove-Item -LiteralPath $wsJs -Force -ErrorAction SilentlyContinue
$wsResult = (($wsOut | Out-String)).Trim()
if ($wsCode -ne 0) { Die "处理 $WS_YML 失败（node 退出码 $wsCode）：$wsResult" }
if ($wsResult -eq 'updated') {
  Say "已确保 $WS_YML：minimumReleaseAgeExclude 包含 $PKG"
} else {
  Say 'workspace 设置已就绪，跳过'
}

# 步骤 2：官方 CLI 安装 + bundle 自动注册（含挂载）
if ($INV.UseNpx) {
  $cliArgs = @('-y', '--package', '@deepseek-ai/dsh', 'dsh', 'plugin', '--profile', 'web', 'add', "$PKG@$SPEC")
} else {
  $cliArgs = @('plugin', '--profile', 'web', 'add', "$PKG@$SPEC")
}
Say "执行 $($INV.Command) plugin --profile web add $PKG@$SPEC ..."
$addOut = & $INV.Command @cliArgs 2>&1
$addCode = $LASTEXITCODE
$addOut | ForEach-Object { $_ }
if ($addCode -ne 0) {
  Warn 'dsh plugin add 失败。可能原因：'
  Warn '  - 网络/登录问题：npm registry 不可达或需要登录。'
  Warn "  - 依赖安装冲突：可手动重试 cd $PROFILE_DIR; pnpm install -w。"
  exit 1
}

# 步骤 3：校验 bundle 已注册（挂载生效的判据）
$pkgJson = Get-Content -Raw (Join-Path $PROFILE_DIR 'package.json') | ConvertFrom-Json
$bundles = @($pkgJson.dsh.profile.bundles)
if ($bundles -notcontains $PKG) {
  Warn "$PKG 未出现在 dsh.profile.bundles 中——挂载未注册。"
  Warn '请确认包已发布且 manifest 中声明了 dsh.bundle.patch 后重跑本脚本。'
  exit 1
}
Say "bundle 已注册：dsh.profile.bundles 包含 $PKG（下次启动自动挂载）"

# 步骤 4：幂等移除旧的 manual 挂载行（避免与 bundle 双挂载）
if (Test-Path $PATCH_YML) {
  $mountScript = @'
const fs = require("fs");
const p = process.argv[2];
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
'@
  $mountJs = Join-Path $env:TEMP ("dshfc-mount-" + [guid]::NewGuid().ToString("N") + ".js")
  Set-Content -LiteralPath $mountJs -Value $mountScript -Encoding UTF8
  $mountOut = node $mountJs "$PATCH_YML" 2>&1
  $mountCode = $LASTEXITCODE
  Remove-Item -LiteralPath $mountJs -Force -ErrorAction SilentlyContinue
  $mountResult = (($mountOut | Out-String)).Trim()
  if ($mountCode -ne 0) { Die "处理 $PATCH_YML 失败（node 退出码 $mountCode）：$mountResult" }
  if ($mountResult -eq 'removed') {
    Say "已从 $PATCH_YML 移除旧的 web-search-firecrawl 手动挂载行（bundle 通道接管挂载）"
  } else {
    Say '无旧手动挂载行，跳过'
  }
} else {
  Say 'profile 尚未生成 cordis.patch.yml，跳过旧挂载清理'
}

Say "安装完成：$PKG@$SPEC"

# 步骤 5：重启提示
if ($Restart) {
  if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    Say '重启 dsh-web（pm2）...'
    pm2 restart dsh-web
    if ($LASTEXITCODE -ne 0) { Warn 'pm2 restart 失败，请手动重启 DSH' }
  } else {
    Warn '未找到 pm2，请手动重启 DSH（如：pm2 restart dsh-web 或 dsh web）'
  }
} else {
  Say '下一步：重启 DSH 并硬刷新（Ctrl+Shift+R / Cmd+Shift+R）使新副本与设置页生效。'
  if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    Say '本机可用：pm2 restart dsh-web（会短暂断开当前页面会话）'
  }
}
