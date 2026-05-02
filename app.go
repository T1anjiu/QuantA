package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"github.com/markcheno/go-talib"
)

type TradeLog struct {
	Date   string  `json:"date"`
	Action string  `json:"action"`
	Price  float64 `json:"price"`
}

type BacktestResult struct {
	Logs         []TradeLog `json:"logs"`
	FinalCapital float64    `json:"final_capital"`
	TotalReturn  float64    `json:"total_return"`
	ChartData    []float64  `json:"chart_data"`
	Dates        []string   `json:"dates"`
	MaxDrawdown  float64    `json:"max_drawdown"`
	SharpeRatio  float64    `json:"sharpe_ratio"`
	SortinoRatio float64    `json:"sortino_ratio"`
	CalmarRatio  float64    `json:"calmar_ratio"`
	WinRate      float64    `json:"win_rate"`
	TotalTrades  int        `json:"total_trades"`
	ProfitTrades int        `json:"profit_trades"`
}

// 计算日收益率序列
func calculateDailyReturns(chartData []float64) []float64 {
	returns := make([]float64, len(chartData)-1)
	for i := 1; i < len(chartData); i++ {
		if chartData[i-1] != 0 {
			returns[i-1] = (chartData[i] - chartData[i-1]) / chartData[i-1]
		}
	}
	return returns
}

// 计算平均值
func mean(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sum := 0.0
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

// 计算标准差
func stdDev(values []float64, avg float64) float64 {
	if len(values) <= 1 {
		return 0
	}
	sum := 0.0
	for _, v := range values {
		diff := v - avg
		sum += diff * diff
	}
	return math.Sqrt(sum / float64(len(values)-1))
}

// 计算下行偏差（仅负收益）
func downsideDeviation(returns []float64, target float64) float64 {
	if len(returns) <= 1 {
		return 0
	}
	sum := 0.0
	count := 0
	for _, r := range returns {
		if r < target {
			diff := r - target
			sum += diff * diff
			count++
		}
	}
	if count == 0 {
		return 0
	}
	return math.Sqrt(sum / float64(count-1))
}

// 计算性能指标
func calculatePerformanceMetrics(result *BacktestResult, riskFreeRate float64) {
	if len(result.ChartData) < 2 {
		return
	}

	// 1. 最大回撤
	peak := result.ChartData[0]
	maxDrawdown := 0.0
	for _, val := range result.ChartData {
		if val > peak {
			peak = val
		}
		drawdown := (peak - val) / peak * 100
		if drawdown > maxDrawdown {
			maxDrawdown = drawdown
		}
	}
	result.MaxDrawdown = maxDrawdown

	// 2. 计算日收益率
	returns := calculateDailyReturns(result.ChartData)

	// 3. 夏普比率 = (年化收益 - 无风险利率) / 年化波动率
	avgReturn := mean(returns)
	annualizedReturn := avgReturn * 252
	std := stdDev(returns, avgReturn)
	annualizedVol := std * math.Sqrt(252)

	if annualizedVol != 0 {
		result.SharpeRatio = (annualizedReturn - riskFreeRate) / annualizedVol
	}

	// 4. 索提诺比率 = (年化收益 - 无风险利率) / 年化下行偏差
	downDev := downsideDeviation(returns, 0)
	annualizedDownDev := downDev * math.Sqrt(252)
	if annualizedDownDev != 0 {
		result.SortinoRatio = (annualizedReturn - riskFreeRate) / annualizedDownDev
	}

	// 5. 卡玛比率 = 年化收益率 / 最大回撤
	if maxDrawdown != 0 {
		result.CalmarRatio = annualizedReturn / (maxDrawdown / 100)
	}

	// 6. 胜率计算
	result.TotalTrades = len(result.Logs) / 2
	if result.TotalTrades > 0 {
		buyPrice := 0.0
		profitCount := 0
		for _, log := range result.Logs {
			if log.Action == "买入" {
				buyPrice = log.Price
			} else if log.Action == "卖出" && buyPrice > 0 {
				if log.Price > buyPrice {
					profitCount++
				}
				buyPrice = 0
			}
		}
		result.ProfitTrades = profitCount
		result.WinRate = float64(profitCount) / float64(result.TotalTrades) * 100
	}
}

type App struct {
	ctx context.Context
}

func NewApp() *App { return &App{} }
func (a *App) startup(ctx context.Context) { a.ctx = ctx }

// 核心函数：回归腾讯 proxy 接口
func (a *App) fetchStockData(symbol string) ([]string, []float64, error) {
	pureSymbol := strings.TrimSpace(symbol)
	if pureSymbol == "" {
		return nil, nil, fmt.Errorf("股票代码不能为空")
	}
	
	pureSymbol = strings.ReplaceAll(pureSymbol, ".SH", "")
	pureSymbol = strings.ReplaceAll(pureSymbol, ".SZ", "")
	
	// 验证股票代码格式：只允许数字，长度6位
	if len(pureSymbol) != 6 {
		return nil, nil, fmt.Errorf("股票代码格式错误（必须为6位数字）: %s", symbol)
	}
	for _, c := range pureSymbol {
		if c < '0' || c > '9' {
			return nil, nil, fmt.Errorf("股票代码包含非法字符（只允许数字）: %s", symbol)
		}
	}
	
	// 判定前缀
	prefix := "sz"
	if strings.HasPrefix(pureSymbol, "6") || strings.HasPrefix(pureSymbol, "5") || strings.HasPrefix(pureSymbol, "688") {
		prefix = "sh"
	}
	code := prefix + pureSymbol

	// 腾讯代理接口：支持 500 条 K 线及前复权
	url := fmt.Sprintf("https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?_var=kline_day&param=%s,day,,,1100,qfq", code)
	
	resp, err := http.Get(url)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("读取响应失败: %v", err)
	}
	content := string(body)

	// 处理 JSONP 格式
	if strings.Contains(content, "=") {
		content = content[strings.Index(content, "=")+1:]
	}

	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(content), &raw); err != nil {
		return nil, nil, fmt.Errorf("解析失败: %v", err)
	}

	data, _ := raw["data"].(map[string]interface{})
	stockData, ok := data[code].(map[string]interface{})
	if !ok {
		return nil, nil, fmt.Errorf("股票代码 %s 无数据", symbol)
	}

	// 优先取前复权数据 qfqday
	var klines []interface{}
	if qfq, ok := stockData["qfqday"].([]interface{}); ok {
		klines = qfq
	} else {
		klines, _ = stockData["day"].([]interface{})
	}

	dates := make([]string, 0, len(klines))
	closes := make([]float64, 0, len(klines))
	for _, k := range klines {
		line, _ := k.([]interface{})
		if len(line) < 3 { continue }

		// line[0] 是日期, line[2] 是收盘价
		dateVal := strings.ReplaceAll(line[0].(string), "-", "")
		priceVal, _ := strconv.ParseFloat(line[2].(string), 64)
		
		dates = append(dates, dateVal)
		closes = append(closes, priceVal)
	}

	if len(dates) == 0 {
		return nil, nil, fmt.Errorf("未找到有效 K 线数据")
	}

	return dates, closes, nil
}

// RunBacktest 支持多指标
func (a *App) RunBacktest(symbol string, initialCapital float64, startDate string, endDate string, indicator string, param1 int, param2 int, param3 int) (BacktestResult, error) {
	// 输入验证
	if initialCapital <= 0 {
		return BacktestResult{}, fmt.Errorf("初始资金必须大于0")
	}

	allDates, allCloses, err := a.fetchStockData(symbol)
	if err != nil {
		return BacktestResult{}, err
	}

	fStart := strings.ReplaceAll(startDate, "-", "")
	fEnd := strings.ReplaceAll(endDate, "-", "")

	// 根据指标类型执行不同的策略
	if indicator == "macd" {
		return a.runMACD(allDates, allCloses, fStart, fEnd, initialCapital, param1, param2, param3)
	} else if indicator == "boll" {
		return a.runBOLL(allDates, allCloses, fStart, fEnd, initialCapital, param1, param2)
	} else if indicator == "rsi" {
		return a.runRSI(allDates, allCloses, fStart, fEnd, initialCapital, param1)
	} else if indicator == "sma" {
		return a.runSMA(allDates, allCloses, fStart, fEnd, initialCapital, param1)
	} else if indicator == "kdj" {
		return a.runKDJ(allDates, allCloses, fStart, fEnd, initialCapital, param1, param2, param3)
	}

	return BacktestResult{}, fmt.Errorf("不支持的指标: %s", indicator)
}

// MACD策略
func (a *App) runMACD(allDates []string, allCloses []float64, fStart string, fEnd string, initialCapital float64, fastPeriod int, slowPeriod int, signalPeriod int) (BacktestResult, error) {
	if fastPeriod <= 0 || slowPeriod <= 0 || signalPeriod <= 0 {
		return BacktestResult{}, fmt.Errorf("MACD参数必须大于0")
	}
	if fastPeriod >= slowPeriod {
		return BacktestResult{}, fmt.Errorf("快线周期必须小于慢线周期")
	}

	dif, dea, _ := talib.Macd(allCloses, fastPeriod, slowPeriod, signalPeriod)

	var logs []TradeLog
	var filteredDates []string
	var filteredChart []float64

	capital := initialCapital
	position := 0.0

	startIndex := 0
	for i, d := range allDates {
		if d >= fStart {
			startIndex = i
			break
		}
	}

	for i := startIndex; i < len(allCloses); i++ {
		if fEnd != "" && allDates[i] > fEnd {
			break
		}

		if i > 0 && dif[i-1] != 0 {
			if position == 0 && dif[i] > dea[i] && dif[i-1] <= dea[i-1] {
				position = capital / allCloses[i]
				capital = 0
				logs = append(logs, TradeLog{Date: allDates[i], Action: "买入", Price: allCloses[i]})
			} else if position > 0 && dif[i] < dea[i] && dif[i-1] >= dea[i-1] {
				capital = position * allCloses[i]
				position = 0
				logs = append(logs, TradeLog{Date: allDates[i], Action: "卖出", Price: allCloses[i]})
			}
		}

		val := capital
		if position > 0 {
			val = position * allCloses[i]
		}
		filteredDates = append(filteredDates, allDates[i])
		filteredChart = append(filteredChart, val)
	}

	if logs == nil { logs = []TradeLog{} }
	finalVal := initialCapital
	if len(filteredChart) > 0 {
		finalVal = filteredChart[len(filteredChart)-1]
	}

	result := BacktestResult{
		Logs:         logs,
		FinalCapital: finalVal,
		TotalReturn:  (finalVal - initialCapital) / initialCapital * 100,
		ChartData:    filteredChart,
		Dates:        filteredDates,
	}
	calculatePerformanceMetrics(&result, 0.025)

	return result, nil
}

// BOLL策略（价格突破下轨买入，突破上轨卖出）
func (a *App) runBOLL(allDates []string, allCloses []float64, fStart string, fEnd string, initialCapital float64, period int, stdDev int) (BacktestResult, error) {
	if period <= 0 {
		return BacktestResult{}, fmt.Errorf("BOLL周期必须大于0")
	}

	upper, _, lower := talib.BBands(allCloses, period, float64(stdDev), float64(stdDev), 0)

	var logs []TradeLog
	var filteredDates []string
	var filteredChart []float64

	capital := initialCapital
	position := 0.0

	startIndex := 0
	for i, d := range allDates {
		if d >= fStart {
			startIndex = i
			break
		}
	}

	for i := startIndex; i < len(allCloses); i++ {
		if fEnd != "" && allDates[i] > fEnd {
			break
		}

		// 跳过前period个数据（布林带计算需要）
		if i < period {
			val := capital
			if position > 0 {
				val = position * allCloses[i]
			}
			filteredDates = append(filteredDates, allDates[i])
			filteredChart = append(filteredChart, val)
			continue
		}

		if upper[i] != 0 && lower[i] != 0 {
			// 价格跌破下轨买入
			if position == 0 && allCloses[i] < lower[i] {
				position = capital / allCloses[i]
				capital = 0
				logs = append(logs, TradeLog{Date: allDates[i], Action: "买入", Price: allCloses[i]})
			} else if position > 0 && allCloses[i] > upper[i] {
				// 价格突破上轨卖出
				capital = position * allCloses[i]
				position = 0
				logs = append(logs, TradeLog{Date: allDates[i], Action: "卖出", Price: allCloses[i]})
			}
		}

		val := capital
		if position > 0 {
			val = position * allCloses[i]
		}
		filteredDates = append(filteredDates, allDates[i])
		filteredChart = append(filteredChart, val)
	}

	if logs == nil { logs = []TradeLog{} }
	finalVal := initialCapital
	if len(filteredChart) > 0 {
		finalVal = filteredChart[len(filteredChart)-1]
	}

	result := BacktestResult{
		Logs:         logs,
		FinalCapital: finalVal,
		TotalReturn:  (finalVal - initialCapital) / initialCapital * 100,
		ChartData:    filteredChart,
		Dates:        filteredDates,
	}
	calculatePerformanceMetrics(&result, 0.025)

	return result, nil
}

// RSI策略（RSI < 30买入，RSI > 70卖出）
func (a *App) runRSI(allDates []string, allCloses []float64, fStart string, fEnd string, initialCapital float64, period int) (BacktestResult, error) {
	if period <= 0 {
		return BacktestResult{}, fmt.Errorf("RSI周期必须大于0")
	}

	rsi := talib.Rsi(allCloses, period)

	var logs []TradeLog
	var filteredDates []string
	var filteredChart []float64

	capital := initialCapital
	position := 0.0

	startIndex := 0
	for i, d := range allDates {
		if d >= fStart {
			startIndex = i
			break
		}
	}

	for i := startIndex; i < len(allCloses); i++ {
		if fEnd != "" && allDates[i] > fEnd {
			break
		}

		// 跳过前period个数据（RSI计算需要）
		if i < period {
			val := capital
			if position > 0 {
				val = position * allCloses[i]
			}
			filteredDates = append(filteredDates, allDates[i])
			filteredChart = append(filteredChart, val)
			continue
		}

		if rsi[i] != 0 {
			// RSI < 30买入（超卖）
			if position == 0 && rsi[i] < 30 {
				position = capital / allCloses[i]
				capital = 0
				logs = append(logs, TradeLog{Date: allDates[i], Action: "买入", Price: allCloses[i]})
			} else if position > 0 && rsi[i] > 70 {
				// RSI > 70卖出（超买）
				capital = position * allCloses[i]
				position = 0
				logs = append(logs, TradeLog{Date: allDates[i], Action: "卖出", Price: allCloses[i]})
			}
		}

		val := capital
		if position > 0 {
			val = position * allCloses[i]
		}
		filteredDates = append(filteredDates, allDates[i])
		filteredChart = append(filteredChart, val)
	}

	if logs == nil { logs = []TradeLog{} }
	finalVal := initialCapital
	if len(filteredChart) > 0 {
		finalVal = filteredChart[len(filteredChart)-1]
	}

	result := BacktestResult{
		Logs:         logs,
		FinalCapital: finalVal,
		TotalReturn:  (finalVal - initialCapital) / initialCapital * 100,
		ChartData:    filteredChart,
		Dates:        filteredDates,
	}
	calculatePerformanceMetrics(&result, 0.025)

	return result, nil
}

// SMA策略（简单移动平均线交叉）
func (a *App) runSMA(allDates []string, allCloses []float64, fStart string, fEnd string, initialCapital float64, period int) (BacktestResult, error) {
	if period <= 0 {
		return BacktestResult{}, fmt.Errorf("SMA周期必须大于0")
	}

	sma := talib.Sma(allCloses, period)

	var logs []TradeLog
	var filteredDates []string
	var filteredChart []float64

	capital := initialCapital
	position := 0.0

	startIndex := 0
	for i, d := range allDates {
		if d >= fStart {
			startIndex = i
			break
		}
	}

	for i := startIndex; i < len(allCloses); i++ {
		if fEnd != "" && allDates[i] > fEnd {
			break
		}

		// 跳过前period个数据（SMA计算需要）
		if i < period {
			val := capital
			if position > 0 {
				val = position * allCloses[i]
			}
			filteredDates = append(filteredDates, allDates[i])
			filteredChart = append(filteredChart, val)
			continue
		}

		if sma[i] != 0 {
			// 价格上穿SMA买入
			if position == 0 && allCloses[i] > sma[i] && allCloses[i-1] <= sma[i-1] {
				position = capital / allCloses[i]
				capital = 0
				logs = append(logs, TradeLog{Date: allDates[i], Action: "买入", Price: allCloses[i]})
			} else if position > 0 && allCloses[i] < sma[i] && allCloses[i-1] >= sma[i-1] {
				// 价格下穿SMA卖出
				capital = position * allCloses[i]
				position = 0
				logs = append(logs, TradeLog{Date: allDates[i], Action: "卖出", Price: allCloses[i]})
			}
		}

		val := capital
		if position > 0 {
			val = position * allCloses[i]
		}
		filteredDates = append(filteredDates, allDates[i])
		filteredChart = append(filteredChart, val)
	}

	if logs == nil { logs = []TradeLog{} }
	finalVal := initialCapital
	if len(filteredChart) > 0 {
		finalVal = filteredChart[len(filteredChart)-1]
	}

	result := BacktestResult{
		Logs:         logs,
		FinalCapital: finalVal,
		TotalReturn:  (finalVal - initialCapital) / initialCapital * 100,
		ChartData:    filteredChart,
		Dates:        filteredDates,
	}
	calculatePerformanceMetrics(&result, 0.025)

	return result, nil
}

// KDJ策略（K上穿D买入，K下穿D卖出）
func (a *App) runKDJ(allDates []string, allCloses []float64, fStart string, fEnd string, initialCapital float64, period int, kSmoothing int, dSmoothing int) (BacktestResult, error) {
	if period <= 0 {
		return BacktestResult{}, fmt.Errorf("KDJ周期必须大于0")
	}
	if kSmoothing <= 0 || dSmoothing <= 0 {
		return BacktestResult{}, fmt.Errorf("KDJ平滑参数必须大于0")
	}

	slowK, slowD := talib.Stoch(allCloses, allCloses, allCloses, period, kSmoothing, talib.SMA, dSmoothing, talib.SMA)

	var logs []TradeLog
	var filteredDates []string
	var filteredChart []float64

	capital := initialCapital
	position := 0.0

	startIndex := 0
	for i, dt := range allDates {
		if dt >= fStart {
			startIndex = i
			break
		}
	}

	for i := startIndex; i < len(allCloses); i++ {
		if fEnd != "" && allDates[i] > fEnd {
			break
		}

		// 跳过前period+参数周期的数据（KDJ计算需要）
		if i < period+kSmoothing+dSmoothing {
			val := capital
			if position > 0 {
				val = position * allCloses[i]
			}
			filteredDates = append(filteredDates, allDates[i])
			filteredChart = append(filteredChart, val)
			continue
		}

		if i > 0 && slowK[i] != 0 && slowD[i] != 0 && slowK[i-1] != 0 && slowD[i-1] != 0 {
			// K上穿D买入
			if position == 0 && slowK[i] > slowD[i] && slowK[i-1] <= slowD[i-1] {
				position = capital / allCloses[i]
				capital = 0
				logs = append(logs, TradeLog{Date: allDates[i], Action: "买入", Price: allCloses[i]})
			} else if position > 0 && slowK[i] < slowD[i] && slowK[i-1] >= slowD[i-1] {
				// K下穿D卖出
				capital = position * allCloses[i]
				position = 0
				logs = append(logs, TradeLog{Date: allDates[i], Action: "卖出", Price: allCloses[i]})
			}
		}

		val := capital
		if position > 0 {
			val = position * allCloses[i]
		}
		filteredDates = append(filteredDates, allDates[i])
		filteredChart = append(filteredChart, val)
	}

	if logs == nil { logs = []TradeLog{} }
	finalVal := initialCapital
	if len(filteredChart) > 0 {
		finalVal = filteredChart[len(filteredChart)-1]
	}

	result := BacktestResult{
		Logs:         logs,
		FinalCapital: finalVal,
		TotalReturn:  (finalVal - initialCapital) / initialCapital * 100,
		ChartData:    filteredChart,
		Dates:        filteredDates,
	}
	calculatePerformanceMetrics(&result, 0.025)

	return result, nil
}
