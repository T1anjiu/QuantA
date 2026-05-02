import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';
import { RunBacktest } from '../wailsjs/go/main/App';

// 1. 注入 CSS 样式（仅修改了颜色变量，买入红、卖出绿）
const style = document.createElement('style');
style.innerHTML = `
    :root {
        --bg-app: #0d1117; --bg-side: #161b22; --border: #30363d;
        --text-main: #c9d1d9; --text-bright: #ffffff; --accent: #3b82f6;
        --color-buy: #ef4444;    /* 买入红色 */
        --color-sell: #10b981;   /* 卖出绿色 */
    }
    .light-theme {
        --bg-app: #ffffff; --bg-side: #f6f8fa; --border: #d0d7de;
        --text-main: #24292f; --text-bright: #0969da; --accent: #0969da;
    }
    body { margin: 0; background: var(--bg-app); color: var(--text-main); font-family: sans-serif; height: 100vh; overflow: hidden; }
    .app-container { display: flex; height: 100vh; }
    
    .sidebar { width: 280px; background: var(--bg-side); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
    .input-group { padding: 20px; display: flex; flex-direction: column; gap: 15px; flex: 1; overflow-y: auto; }
    
    .param-box { padding: 12px; background: rgba(59,130,246,0.05); border: 1px dashed var(--border); border-radius: 8px; }
    .input-field, select.input-field { width: 100%; background: var(--bg-app); border: 1px solid var(--border); color: var(--text-main); padding: 8px; border-radius: 6px; box-sizing: border-box; }
    select.input-field { cursor: pointer; }

    /* 新增 placeholder 颜色：更淡，避免误认为已填入内容 */
    .dark-theme .input-field::placeholder {
        color: rgba(255, 255, 255, 0.35);
    }
    .light-theme .input-field::placeholder {
        color: rgba(0, 0, 0, 0.35);
    }

    /* 针对日期输入框的暗色模式优化 */
    .dark-theme .input-field[type="date"] { color-scheme: dark; }
    .light-theme .input-field[type="date"] { color-scheme: light; }
    
    .text-buy { color: var(--color-buy) !important; font-weight: bold; }
    .text-sell { color: var(--color-sell) !important; font-weight: bold; }
    
    main { flex: 1; display: flex; flex-direction: column; background: var(--bg-app); }
    #chart-box { flex: 1; width: 100%; height: 100%; }
    .log-view { height: 250px; background: var(--bg-side); border-top: 1px solid var(--border); overflow-y: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 10px 15px; text-align: left; border-bottom: 1px solid var(--border); }
    th { font-weight: 700; color: var(--text-main); }
    
    /* 平滑主题切换过渡 */
    * {
        transition: background-color 0.3s ease, 
                    color 0.3s ease, 
                    border-color 0.3s ease, 
                    box-shadow 0.3s ease;
    }
    
    .btn-run { margin: 15px; padding: 12px; background: var(--accent); color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; }
`;
document.head.appendChild(style);

// 2. 注入 HTML 结构（未改动）
document.querySelector('#app').innerHTML = `
    <div id="app-frame" class="app-container dark-theme">
        <aside class="sidebar">
            <div style="padding:15px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between;">
                <b style="color:var(--accent)">QUANT-A</b>
                <button id="themeToggle" style="font-size:14px; background:transparent; border:none; cursor:pointer; color:var(--text-main);">☀️ 切换 🌙</button>
            </div>
            <div class="input-group">
                <label style="font-size:12px; color:gray;">技术指标</label>
                <select id="inIndicator" class="input-field">
                    <option value="macd">MACD (异同移动平均线)</option>
                    <option value="boll">BOLL (布林带)</option>
                    <option value="rsi">RSI (相对强弱指标)</option>
                    <option value="sma">SMA (简单移动平均线)</option>
                    <option value="kdj">KDJ (随机指标)</option>
                </select>

                <label style="font-size:12px; color:gray;">标的配置</label>
                <input id="inCode" placeholder="股票代码" class="input-field">
                <input id="inCap" placeholder="初始资金" class="input-field">
                
                <div id="param-box" class="param-box">
                    <label style="font-size:12px; color:var(--accent);">MACD 参数</label>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; margin-top:5px;">
                        <input id="inParam1" placeholder="快线" value="12" class="input-field" title="快线">
                        <input id="inParam2" placeholder="慢线" value="26" class="input-field" title="慢线">
                        <input id="inParam3" placeholder="信号" value="9" class="input-field" title="信号">
                    </div>
                </div>

                <label style="font-size:12px; color:gray;">回测时间（仅支持2023年9月以后的数据）</label>
                <div style="font-size:11px; color:gray; margin-bottom:-5px;">起始日期</div>
                <input id="inStart" type="date" class="input-field">
                <div style="font-size:11px; color:gray; margin-bottom:-5px;">截止日期</div>
                <input id="inEnd" type="date" class="input-field">
            </div>
            <button id="runBtn" class="btn-run">开始执行 / RUN</button>
            <button id="exportBtn" class="btn-run" style="background:#10b981;margin-top:0;">导出图表 / EXPORT</button>
        </aside>
        <main>
            <div style="padding:15px; display:flex; flex-wrap:wrap; gap:20px; border-bottom:1px solid var(--border); background:var(--bg-side);">
                <div><small style="color:gray;">最终资产</small><div id="resCap" style="font-size:18px; font-weight:bold;">¥ --</div></div>
                <div><small style="color:gray;">累计收益</small><div id="resRet" style="font-size:18px; font-weight:bold;">-- %</div></div>
                <div><small style="color:gray;">最大回撤</small><div id="resDD" style="font-size:18px; font-weight:bold;">-- %</div></div>
                <div><small style="color:gray;">夏普比率</small><div id="resSharpe" style="font-size:18px; font-weight:bold;">--</div></div>
                <div><small style="color:gray;">索提诺比率</small><div id="resSortino" style="font-size:18px; font-weight:bold;">--</div></div>
                <div><small style="color:gray;">卡玛比率</small><div id="resCalmar" style="font-size:18px; font-weight:bold;">--</div></div>
                <div><small style="color:gray;">胜率</small><div id="resWinRate" style="font-size:18px; font-weight:bold;">-- %</div></div>
                <div><small style="color:gray;">交易次数</small><div id="resTrades" style="font-size:18px; font-weight:bold;">--</div></div>
            </div>
            <div id="chart-box"></div>
            <div class="log-view">
                <table>
                    <thead><tr><th>📅 日期</th><th>📊 操作</th><th>💰 价格</th></tr></thead>
                    <tbody id="logBody"></tbody>
                </table>
            </div>
        </main>
    </div>
`;

// 3. 核心逻辑
let myChart = null, currentTheme = 'dark', lastRes = null;
let currentParams = {
    symbol: '',
    indicator: '',
    indicatorName: '',
    params: '',
    startDate: '',
    endDate: ''
};

function getThemeVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// 渲染日志（买入红色、卖出绿色，由 CSS 类控制，颜色变量已互换）
function renderLogs(logs) {
    const tbody = document.getElementById('logBody');
    tbody.innerHTML = logs.map(l => {
        const isBuy = l.action === '买入' || l.action.toUpperCase() === 'BUY';
        return `<tr>
            <td style="color:var(--text-bright)">${l.date}</td>
            <td class="${isBuy ? 'text-buy' : 'text-sell'}">${l.action}</td>
            <td style="color:var(--accent)">¥${l.price.toFixed(2)}</td>
        </tr>`;
    }).join('');
}

// 渲染图表（使用Lightweight Charts）
function renderChart(res) {
    if (myChart) myChart.remove();

    const container = document.getElementById('chart-box');
    if (!container) return;

    const isLight = currentTheme === 'light';
    const textColor = isLight ? '#24292f' : '#c9d1d9';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(128, 128, 128, 0.1)';

    const chartOptions = {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: {
            background: { type: ColorType.Solid, color: 'transparent' },
            textColor: textColor,
        },
        grid: {
            vertLines: { color: gridColor, style: 1, visible: true },
            horzLines: { color: gridColor, style: 1, visible: true },
        },
        rightPriceScale: {
            borderColor: 'transparent',
            visible: true,
        },
        timeScale: {
            borderColor: 'transparent',
            timeVisible: true,
            secondsVisible: false,
        },
        crosshair: {
            mode: CrosshairMode.Normal,
        },
    };

    myChart = createChart(container, chartOptions);

    const areaSeriesOptions = {
        lineColor: '#3b82f6',
        topColor: 'rgba(59,130,246,0.3)',
        bottomColor: 'transparent',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
    };

    const areaSeries = myChart.addAreaSeries(areaSeriesOptions);

    const chartData = res.dates.map((date, i) => ({
        time: date.substring(0, 4) + '-' + date.substring(4, 6) + '-' + date.substring(6, 8),
        value: res.chart_data[i],
    }));
    
    areaSeries.setData(chartData);

    // 使用 markers API
    const markers = res.logs.map(log => {
        const isBuy = log.action === '买入' || log.action.toUpperCase() === 'BUY';
        const dateStr = log.date;
        const formattedDate = dateStr.substring(0, 4) + '-' + dateStr.substring(4, 6) + '-' + dateStr.substring(6, 8);
        return {
            time: formattedDate,
            position: isBuy ? 'belowBar' : 'aboveBar',
            color: isBuy ? '#ef4444' : '#10b981',
            shape: isBuy ? 'arrowUp' : 'arrowDown',
            text: isBuy ? '买' : '卖',
        };
    });
    
    areaSeries.setMarkers(markers);

    myChart.timeScale().fitContent();
}

// 动态更新参数框
function updateParamBox(indicator) {
    const paramBox = document.getElementById('param-box');
    
    switch(indicator) {
        case 'macd':
            paramBox.innerHTML = `
                <label style="font-size:12px; color:var(--accent);">MACD 参数</label>
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; margin-top:5px;">
                    <input id="inParam1" placeholder="快线" value="12" class="input-field" title="快线">
                    <input id="inParam2" placeholder="慢线" value="26" class="input-field" title="慢线">
                    <input id="inParam3" placeholder="信号" value="9" class="input-field" title="信号">
                </div>
            `;
            break;
        case 'boll':
            paramBox.innerHTML = `
                <label style="font-size:12px; color:var(--accent);">BOLL 参数</label>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-top:5px;">
                    <input id="inParam1" placeholder="周期" value="20" class="input-field" title="周期">
                    <input id="inParam2" placeholder="标准差" value="2" class="input-field" title="标准差">
                </div>
            `;
            break;
        case 'rsi':
            paramBox.innerHTML = `
                <label style="font-size:12px; color:var(--accent);">RSI 参数</label>
                <div style="display:grid; grid-template-columns:1fr; gap:5px; margin-top:5px;">
                    <input id="inParam1" placeholder="周期" value="14" class="input-field" title="周期">
                </div>
            `;
            break;
        case 'sma':
            paramBox.innerHTML = `
                <label style="font-size:12px; color:var(--accent);">SMA 参数</label>
                <div style="display:grid; grid-template-columns:1fr; gap:5px; margin-top:5px;">
                    <input id="inParam1" placeholder="周期" value="20" class="input-field" title="周期">
                </div>
            `;
            break;
        case 'kdj':
            paramBox.innerHTML = `
                <label style="font-size:12px; color:var(--accent);">KDJ 参数</label>
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; margin-top:5px;">
                    <input id="inParam1" placeholder="周期" value="9" class="input-field" title="周期">
                    <input id="inParam2" placeholder="平滑K" value="3" class="input-field" title="平滑K">
                    <input id="inParam3" placeholder="平滑D" value="3" class="input-field" title="平滑D">
                </div>
            `;
            break;
    }
}

// 指标切换监听器
document.getElementById('inIndicator').onchange = function() {
    updateParamBox(this.value);
};

// 获取参数字符串
function getParamString(indicator) {
    const p1 = document.getElementById('inParam1').value;
    const p2 = document.getElementById('inParam2') ? document.getElementById('inParam2').value : '';
    const p3 = document.getElementById('inParam3') ? document.getElementById('inParam3').value : '';
    
    switch(indicator) {
        case 'macd': return `快线:${p1} 慢线:${p2} 信号:${p3}`;
        case 'boll': return `周期:${p1} 标准差:${p2}`;
        case 'rsi': return `周期:${p1}`;
        case 'sma': return `周期:${p1}`;
        case 'kdj': return `周期:${p1} 平滑K:${p2} 平滑D:${p3}`;
        default: return '';
    }
}

// 点击运行（处理收益颜色和符号，以及最终资产数字颜色）
document.getElementById('runBtn').onclick = async () => {
    const btn = document.getElementById('runBtn');
    btn.innerText = "正在运行...";
    try {
        const indicator = document.getElementById('inIndicator').value;
        const res = await RunBacktest(
            document.getElementById('inCode').value,
            parseFloat(document.getElementById('inCap').value),
            document.getElementById('inStart').value,
            document.getElementById('inEnd').value,
            indicator,
            parseInt(document.getElementById('inParam1').value),
            parseInt(document.getElementById('inParam2') ? document.getElementById('inParam2').value : 0),
            parseInt(document.getElementById('inParam3') ? document.getElementById('inParam3').value : 0)
        );
        lastRes = res;

        // 保存当前参数用于导出
        const indicatorNames = {
            'macd': 'MACD',
            'boll': 'BOLL',
            'rsi': 'RSI',
            'sma': 'SMA',
            'kdj': 'KDJ'
        };
        currentParams = {
            symbol: document.getElementById('inCode').value,
            indicator: indicator,
            indicatorName: indicatorNames[indicator] || indicator,
            params: getParamString(indicator),
            startDate: document.getElementById('inStart').value || '起始',
            endDate: document.getElementById('inEnd').value || '至今'
        };

        // 最终资产数字颜色：亮色模式黑色，暗色模式白色
        const capElement = document.getElementById('resCap');
        capElement.innerText = `¥ ${res.final_capital.toLocaleString()}`;
        capElement.style.color = currentTheme === 'light' ? '#000000' : '';

        // 累计收益：正红负绿，并显式添加符号
        const ret = res.total_return;
        const retElement = document.getElementById('resRet');
        retElement.innerText = `${ret > 0 ? '+' : ''}${ret.toFixed(2)}%`;
        retElement.style.color = ret >= 0 ? '#ef4444' : '#10b981';  // 盈利红色，亏损绿色

        // 更新新指标
        document.getElementById('resDD').innerText = `${res.max_drawdown.toFixed(2)}%`;
        document.getElementById('resDD').style.color = '#ef4444';

        document.getElementById('resSharpe').innerText = res.sharpe_ratio.toFixed(2);
        document.getElementById('resSharpe').style.color = res.sharpe_ratio > 1 ? '#10b981' : '#ef4444';

        document.getElementById('resSortino').innerText = res.sortino_ratio.toFixed(2);

        document.getElementById('resCalmar').innerText = res.calmar_ratio.toFixed(2);

        document.getElementById('resWinRate').innerText = `${res.win_rate.toFixed(1)}%`;
        document.getElementById('resWinRate').style.color = res.win_rate > 50 ? '#10b981' : '#ef4444';

        document.getElementById('resTrades').innerText = res.total_trades;

        renderChart(res);
        renderLogs(res.logs);
    } catch (e) { alert(e); }
    btn.innerText = "开始执行 / RUN";
};

// 主题切换逻辑（更新主题类、按钮符号，并调整最终资产颜色）
document.getElementById('themeToggle').onclick = () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    const frame = document.getElementById('app-frame');
    frame.className = `app-container ${currentTheme}-theme`;
    // 更新按钮符号
    const btn = document.getElementById('themeToggle');
    btn.innerHTML = currentTheme === 'dark' ? '☀️ 切换 🌙' : '🌙 切换 ☀️';

    // 根据主题调整最终资产数字颜色
    const capElement = document.getElementById('resCap');
    if (lastRes) {
        capElement.style.color = currentTheme === 'light' ? '#000000' : '';
        renderChart(lastRes);
    }
};

window.onresize = () => {
    if (myChart) {
        const container = document.getElementById('chart-box');
        if (container) {
            myChart.applyOptions({
                width: container.clientWidth,
                height: container.clientHeight,
            });
        }
    }
};

// 导出图表为图片
document.getElementById('exportBtn').onclick = async () => {
    if (!myChart || !lastRes) {
        alert('请先运行回测！');
        return;
    }

    const btn = document.getElementById('exportBtn');
    btn.innerText = "正在导出...";
    
    try {
        // 获取图表截图（返回的是 Canvas 元素）
        const chartCanvas = await myChart.takeScreenshot();
        
        // 创建新的 Canvas 用于添加信息
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // 设置 Canvas 尺寸与图表相同
        canvas.width = chartCanvas.width;
        canvas.height = chartCanvas.height;
        
        // 绘制图表
        ctx.drawImage(chartCanvas, 0, 0);
        
        // 左上角信息
        const info = [
            `股票代码: ${currentParams.symbol}`,
            `指标: ${currentParams.indicatorName} (${currentParams.params})`,
            `回测时间: ${currentParams.startDate} ~ ${currentParams.endDate}`,
            `最终资产: ¥${lastRes.final_capital.toLocaleString()}`,
            `累计收益: ${lastRes.total_return > 0 ? '+' : ''}${lastRes.total_return.toFixed(2)}%`,
            `最大回撤: ${lastRes.max_drawdown.toFixed(2)}%`,
            `夏普比率: ${lastRes.sharpe_ratio.toFixed(2)}`,
            `胜率: ${lastRes.win_rate.toFixed(1)}%`
        ];
        
        // 绘制半透明背景
        const padding = 10;
        const lineHeight = 20;
        ctx.font = '12px sans-serif';
        const textWidth = Math.max(...info.map(line => ctx.measureText(line).width));
        const bgWidth = textWidth + padding * 2;
        const bgHeight = info.length * lineHeight + padding * 2;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, 10, bgWidth, bgHeight);
        
        // 绘制文字
        ctx.fillStyle = '#ffffff';
        info.forEach((line, idx) => {
            ctx.fillText(line, 10 + padding, 10 + padding + (idx + 1) * lineHeight - 5);
        });
        
        // 导出图片
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `QuantA_${currentParams.symbol}_${currentParams.indicator}_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 'image/png');
        
    } catch (e) {
        alert('导出失败: ' + e.message);
    }
    
    btn.innerText = "导出图表 / EXPORT";
};