export namespace main {
	
	export class TradeLog {
	    date: string;
	    action: string;
	    price: number;
	
	    static createFrom(source: any = {}) {
	        return new TradeLog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.action = source["action"];
	        this.price = source["price"];
	    }
	}
	export class BacktestResult {
	    logs: TradeLog[];
	    final_capital: number;
	    total_return: number;
	    chart_data: number[];
	    dates: string[];
	    max_drawdown: number;
	    sharpe_ratio: number;
	    sortino_ratio: number;
	    calmar_ratio: number;
	    win_rate: number;
	    total_trades: number;
	    profit_trades: number;
	
	    static createFrom(source: any = {}) {
	        return new BacktestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.logs = this.convertValues(source["logs"], TradeLog);
	        this.final_capital = source["final_capital"];
	        this.total_return = source["total_return"];
	        this.chart_data = source["chart_data"];
	        this.dates = source["dates"];
	        this.max_drawdown = source["max_drawdown"];
	        this.sharpe_ratio = source["sharpe_ratio"];
	        this.sortino_ratio = source["sortino_ratio"];
	        this.calmar_ratio = source["calmar_ratio"];
	        this.win_rate = source["win_rate"];
	        this.total_trades = source["total_trades"];
	        this.profit_trades = source["profit_trades"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

