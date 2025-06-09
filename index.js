export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const country = request.cf?.country || 'CN';

    // 处理加载IP列表的请求
    if (url.searchParams.get('loadIPs')) {
      const ipSource = url.searchParams.get('loadIPs');
      const ips = await GetCFIPs(ipSource);
      return new Response(JSON.stringify({ ips }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 处理保存优选IP的请求（可选，需绑定KV，未做权限校验）
    if (request.method === "POST") {
      // 你可以自定义存储方式
      return new Response("保存功能请自行根据实际需求实现");
    }

    // 默认返回UI页面
    return new Response(renderHTML(country), {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  }
}

// 生成CF IP列表
async function GetCFIPs(ipSource = 'official') {
  try {
    let response;
    if (ipSource === 'as13335') {
      response = await fetch('https://raw.githubusercontent.com/ipverse/asn-ip/master/as/13335/ipv4-aggregated.txt');
    } else if (ipSource === 'as209242') {
      response = await fetch('https://raw.githubusercontent.com/ipverse/asn-ip/master/as/209242/ipv4-aggregated.txt');
    } else if (ipSource === 'cm') {
      response = await fetch('https://raw.githubusercontent.com/cmliu/cmliu/main/CF-CIDR.txt');
    } else if (ipSource === 'baipiao') {
      response = await fetch('https://raw.githubusercontent.com/cmliu/ACL4SSR/main/baipiao.txt');
      const text = response.ok ? await response.text() : '';
      const ips = text.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
      return ips;
    } else {
      response = await fetch('https://www.cloudflare.com/ips-v4/');
    }

    const text = response.ok ? await response.text() : '';
    const cidrs = text.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    const ips = new Set();
    const targetCount = 1000;
    let round = 1;

    while (ips.size < targetCount && round < 10) {
      for (const cidr of cidrs) {
        if (ips.size >= targetCount) break;
        const cidrIPs = generateIPsFromCIDR(cidr.trim(), round);
        cidrIPs.forEach(ip => ips.add(ip));
      }
      round++;
    }
    return Array.from(ips).slice(0, targetCount);
  } catch (error) {
    return [];
  }
}

// 根据CIDR随机生成IP
function generateIPsFromCIDR(cidr, count = 1) {
  const [network, prefixLength] = cidr.split('/');
  const prefix = parseInt(prefixLength);
  const ipToInt = (ip) => ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
  const intToIP = (int) => [
    (int >>> 24) & 255, (int >>> 16) & 255, (int >>> 8) & 255, int & 255
  ].join('.');
  const networkInt = ipToInt(network);
  const hostBits = 32 - prefix;
  const numHosts = Math.pow(2, hostBits);
  const maxHosts = numHosts - 2;
  const actualCount = Math.min(count, maxHosts);
  const ips = new Set();
  if (maxHosts <= 0) return [];
  let attempts = 0;
  const maxAttempts = actualCount * 10;
  while (ips.size < actualCount && attempts < maxAttempts) {
    const randomOffset = Math.floor(Math.random() * maxHosts) + 1;
    const randomIP = intToIP(networkInt + randomOffset);
    ips.add(randomIP);
    attempts++;
  }
  return Array.from(ips);
}

// 返回页面HTML
function renderHTML(country) {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Cloudflare IP优选</title>
  <meta charset="utf-8">
  <style>
    body { font-family: Tahoma, Verdana, Arial, sans-serif; padding:20px; max-width:900px; margin:auto; }
    .ip-list { background:#f5f5f5; padding:8px; border-radius:5px; max-height:280px; overflow-y:auto; }
    .ip-item { margin:2px 0; font-family:monospace; }
    .good-latency { color:#4CAF50; font-weight:bold;}
    .medium-latency { color:#FF9800; font-weight:bold;}
    .bad-latency { color:#f44336; font-weight:bold;}
    .stats { background:#e3f2fd; padding:10px; border-radius:5px; margin:10px 0;}
    .test-controls { margin:15px 0; }
    .test-button { background:#4CAF50; color:white; padding:10px 18px; font-size:15px; border:none; border-radius:4px; cursor:pointer;}
    .test-button:disabled { background:#ccc;}
    .progress { width:100%; background:#f0f0f0; border-radius:5px; margin:8px 0; }
    .progress-bar { width:0%; height:16px; background:#4CAF50; border-radius:5px; transition:width 0.3s;}
  </style>
</head>
<body>
  <h2>Cloudflare IP优选</h2>
  <div class="stats">
    <b>您的国家：</b>${country}<br>
    <b>获取到的IP总数：</b><span id="ip-count">点击开始测试后加载</span><br>
    <b>测试进度：</b><span id="progress-text">未开始</span>
    <div class="progress"><div class="progress-bar" id="progress-bar"></div></div>
  </div>
  <div class="test-controls">
    <label>IP库:
      <select id="ip-source-select">
        <option value="official">CF官方</option>
        <option value="cm">CM整理</option>
        <option value="as13335">AS13335</option>
        <option value="as209242">AS209242</option>
        <option value="baipiao">反代IP</option>
      </select>
    </label>
    <label style="margin-left:12px;">端口:
      <select id="port-select">
        <option value="443">443</option>
        <option value="2053">2053</option>
        <option value="2083">2083</option>
        <option value="2087">2087</option>
        <option value="2096">2096</option>
        <option value="8443">8443</option>
      </select>
    </label>
    <button class="test-button" id="test-btn" onclick="startTest()">开始延迟测试</button>
  </div>
  <h3>IP列表 <span id="result-count"></span></h3>
  <div class="ip-list" id="ip-list">
    <div class="ip-item">请选择端口和IP库，然后点击"开始延迟测试"加载IP列表</div>
  </div>
<script>
let originalIPs = [], testResults = [], displayedResults = [];
function updateButtonStates() {
  document.getElementById('test-btn').disabled = false;
}
async function startTest() {
  const testBtn = document.getElementById('test-btn');
  const portSelect = document.getElementById('port-select');
  const ipSourceSelect = document.getElementById('ip-source-select');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const ipList = document.getElementById('ip-list');
  const resultCount = document.getElementById('result-count');
  const ipCount = document.getElementById('ip-count');
  const selectedPort = portSelect.value;
  const selectedIPSource = ipSourceSelect.value;
  testBtn.disabled = true;
  testBtn.textContent = '加载IP列表...';
  portSelect.disabled = true; ipSourceSelect.disabled = true;
  testResults = []; displayedResults = [];
  ipList.innerHTML = '<div class="ip-item">正在加载IP列表，请稍候...</div>';
  progressBar.style.width = '0%';
  progressText.textContent = '正在加载 IP库...';
  // 加载IP列表
  originalIPs = await loadIPs(selectedIPSource);
  if (originalIPs.length === 0) {
    ipList.innerHTML = '<div class="ip-item">加载IP列表失败，请重试</div>';
    ipCount.textContent = '0 个';
    testBtn.disabled = false; testBtn.textContent = '开始延迟测试';
    portSelect.disabled = false; ipSourceSelect.disabled = false;
    progressText.textContent = '加载失败';
    return;
  }
  ipCount.textContent = `${originalIPs.length} 个`;
  ipList.innerHTML = originalIPs.map(ip => `<div class="ip-item">${ip}</div>`).join('');
  testBtn.textContent = '测试中...';
  progressText.textContent = `开始测试端口 ${selectedPort}...`;
  // 使用16个并发测试
  const results = await testIPsWithConcurrency(originalIPs, selectedPort, 16);
  testResults = results.sort((a, b) => a.latency - b.latency);
  displayResults();
  testBtn.disabled = false; testBtn.textContent = '重新测试';
  portSelect.disabled = false; ipSourceSelect.disabled = false;
  progressText.textContent = `完成 - 有效IP: ${testResults.length}/${originalIPs.length} (端口: ${selectedPort})`;
}
async function loadIPs(ipSource) {
  try {
    const response = await fetch(`?loadIPs=${ipSource}`, { method: 'GET' });
    if (!response.ok) throw new Error('Failed to load IPs');
    const data = await response.json();
    return data.ips || [];
  } catch (error) {
    return [];
  }
}
async function testIPsWithConcurrency(ips, port, maxConcurrency = 16) {
  const results = [], totalIPs = ips.length;
  let completedTests = 0; const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  let index = 0;
  async function worker() {
    while (index < ips.length) {
      const currentIndex = index++;
      const ip = ips[currentIndex];
      const result = await testIP(ip, port);
      if (result) results.push(result);
      completedTests++;
      const progress = (completedTests / totalIPs) * 100;
      progressBar.style.width = progress + '%';
      progressText.textContent = `${completedTests}/${totalIPs} (${progress.toFixed(1)}%) - 有效IP: ${results.length}`;
    }
  }
  const workers = Array(Math.min(maxConcurrency, ips.length)).fill().map(() => worker());
  await Promise.all(workers);
  return results;
}
async function testIP(ip, port) {
  const timeout = 999;
  const parsedIP = parseIPFormat(ip, port);
  if (!parsedIP) return null;
  // 只进行一次测试即可（可改为多次取最小值）
  const result = await singleTest(parsedIP.host, parsedIP.port, timeout);
  if (!result) return null;
  const displayLatency = Math.floor(result.latency / 2);
  const comment = parsedIP.comment || 'CF优选IP';
  const display = `${parsedIP.host}:${parsedIP.port}#${comment} ${displayLatency}ms`;
  return {
    ip: parsedIP.host,
    port: parsedIP.port,
    latency: displayLatency,
    comment: comment,
    display: display
  };
}
function parseIPFormat(ipString, defaultPort) {
  try {
    let host, port, comment;
    let mainPart = ipString;
    if (ipString.includes('#')) {
      const parts = ipString.split('#');
      mainPart = parts[0];
      comment = parts[1];
    }
    if (mainPart.includes(':')) {
      const parts = mainPart.split(':');
      host = parts[0];
      port = parseInt(parts[1]);
    } else {
      host = mainPart;
      port = parseInt(defaultPort);
    }
    if (!host || !port || isNaN(port)) return null;
    return { host: host.trim(), port: port, comment: comment ? comment.trim() : null };
  } catch (error) { return null; }
}
async function singleTest(ip, port, timeout) {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    await fetch(`https://${ip}:${port}/cdn-cgi/trace`, {
      signal: controller.signal, mode: 'cors'
    });
    clearTimeout(timeoutId);
    return null;
  } catch (error) {
    const latency = Date.now() - startTime;
    if (latency >= timeout - 50) return null;
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      return { ip: ip, port: port, latency: latency };
    }
    return null;
  }
}
function displayResults() {
  const ipList = document.getElementById('ip-list');
  const resultCount = document.getElementById('result-count');
  if (testResults.length === 0) {
    ipList.innerHTML = '<div class="ip-item">未找到有效的IP</div>';
    resultCount.textContent = '';
    displayedResults = [];
    updateButtonStates();
    return;
  }
  const displayCount = Math.min(testResults.length, 16);
  displayedResults = testResults.slice(0, displayCount);
  resultCount.textContent = `(显示前 ${displayCount} 个最优IP，共测试出 ${testResults.length} 个有效IP)`;
  ipList.innerHTML = displayedResults.map(result => {
    let className = 'good-latency';
    if (result.latency > 200) className = 'bad-latency';
    else if (result.latency > 100) className = 'medium-latency';
    return `<div class="ip-item ${className}">${result.display}</div>`;
  }).join('');
  updateButtonStates();
}
</script>
</body></html>
  `;
}
