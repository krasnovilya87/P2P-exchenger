import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronDown, ArrowLeftRight, Settings, X, Info, AlertTriangle, Check } from 'lucide-react';

const PRIORITY_CURRENCIES = [
  { code: 'USD', flag: '🇺🇸' },
  { code: 'EUR', flag: '🇪🇺' },
  { code: 'RUB', flag: '🇷🇺' },
  { code: 'IDR', flag: '🇮🇩' },
  { code: 'CNY', flag: '🇨🇳' },
  { code: 'THB', flag: '🇹🇭' },
  { code: 'KZT', flag: '🇰🇿' },
  { code: 'BYN', flag: '🇧🇾' },
];

const COMMON_FLAGS: Record<string, string> = {
  'USD': '🇺🇸', 'EUR': '🇪🇺', 'RUB': '🇷🇺', 'IDR': '🇮🇩', 'CNY': '🇨🇳', 'THB': '🇹🇭', 'KZT': '🇰🇿', 'BYN': '🇧🇾',
  'UAH': '🇺🇦', 'TRY': '🇹🇷', 'UZS': '🇺🇿', 'GEL': '🇬🇪', 'GBP': '🇬🇧', 'JPY': '🇯🇵', 'AUD': '🇦🇺', 'CAD': '🇨🇦',
  'CHF': '🇨🇭', 'KRW': '🇰🇷', 'BRL': '🇧🇷', 'INR': '🇮🇳', 'SGD': '🇸🇬', 'PLN': '🇵🇱', 'ILS': '🇮🇱', 'AED': '🇦🇪'
};

const App = () => {
  // --- STATE ---
  const [sourceCurr, setSourceCurr] = useState(() => localStorage.getItem('p2p_source_curr') || 'RUB');
  const [targetCurr, setTargetCurr] = useState(() => localStorage.getItem('p2p_target_curr') || 'THB');
  
  const [configuredCurrencies, setConfiguredCurrencies] = useState<string[]>(() => {
    const saved = localStorage.getItem('p2p_configured_currencies');
    return saved ? JSON.parse(saved) : ['RUB', 'THB', 'USD', 'EUR'];
  });

  const [calcMode, setCalcMode] = useState<'approx' | 'exact'>(() => {
    return (localStorage.getItem('p2p_calc_mode') as 'approx' | 'exact') || 'approx';
  });

  const [showSettings, setShowSettings] = useState(false);
  const [isProMode, setIsProMode] = useState(() => localStorage.getItem('p2p_pro_mode') === 'true');
  
  const [showWarningPopup, setShowWarningPopup] = useState(false);
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);
  const [isCorrectChecked, setIsCorrectChecked] = useState(false);
  const [isSaveChecked, setIsSaveChecked] = useState(false);

  // Spreads are strictly empty/0 by default
  const [spreads, setSpreads] = useState<Record<string, { buy: string; sell: string }>>(() => {
    const saved = localStorage.getItem('p2p_spreads');
    return saved ? JSON.parse(saved) : {};
  });

  const [buyRate, setBuyRate] = useState<string>('0.00');
  const [sellRate, setSellRate] = useState<string>('0.00');
  const [amountBuy, setAmountBuy] = useState<string>('10 000');
  const [amountSale, setAmountSale] = useState<string>('');
  const [amountUsdt, setAmountUsdt] = useState<string>('');

  const [apiRates, setApiRates] = useState<Record<string, number>>({});

  const allAvailableCurrencies = useMemo(() => {
    const apiCodes = Object.keys(apiRates);
    if (apiCodes.length === 0) return PRIORITY_CURRENCIES.map(c => c.code);
    const priorityCodes = PRIORITY_CURRENCIES.map(c => c.code);
    const others = apiCodes.filter(c => !priorityCodes.includes(c)).sort();
    return [...priorityCodes, ...others];
  }, [apiRates]);

  const lastSource = useRef(sourceCurr);
  const lastTarget = useRef(targetCurr);
  const warningTimer = useRef<number | null>(null);

  // --- HELPERS ---
  const p = (val: string) => {
    if (!val) return 0;
    const cleaned = val.toString().replace(/\s/g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
  };

  const formatInputString = (val: string) => {
    let clean = val.replace(/,/g, '.').replace(/[^\d.-]/g, '');
    const parts = clean.split('.');
    if (parts.length > 2) clean = parts[0] + '.' + parts.slice(1).join('');
    const dotIndex = clean.indexOf('.');
    if (dotIndex !== -1) {
       const intPart = clean.substring(0, dotIndex);
       const decPart = clean.substring(dotIndex + 1);
       return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + '.' + decPart;
    } else {
       return clean.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    }
  };

  const fmt = (num: number, decimals: number = 2) => {
    if (!num && num !== 0) return '';
    if (isNaN(num)) return '';
    const str = Number.isInteger(num) ? num.toString() : num.toFixed(decimals);
    return formatInputString(str);
  };

  const markAsConfigured = (curr: string) => {
    if (!configuredCurrencies.includes(curr)) {
      const next = [...configuredCurrencies, curr];
      setConfiguredCurrencies(next);
      localStorage.setItem('p2p_configured_currencies', JSON.stringify(next));
    }
  };

  /**
   * Calculates the percentage difference with high precision 
   * but treats extremely small values as zero to avoid floating point noise.
   */
  const calculateSpread = (r: number, cb: number) => {
    if (!r || !cb) return 0;
    // Use an epsilon for equality to handle float precision issues
    if (Math.abs(r - cb) < 0.00000001) return 0;
    return ((r - cb) / cb) * 100;
  };

  const getRateInfo = (rateStr: string, currency: string) => {
    const r = p(rateStr);
    const cb = apiRates[currency];
    if (!r || !cb) return null;
    
    const diff = calculateSpread(r, cb);
    
    // Determine the precision of the CB rate from the API
    const cbRawStr = cb.toString();
    const dotIndex = cbRawStr.indexOf('.');
    // Use the natural decimals of CB, minimum 2, maximum 6 for readability
    const cbPrecision = dotIndex === -1 ? 2 : Math.min(Math.max(cbRawStr.length - dotIndex - 1, 2), 6);

    // Format diff to string using the SAME precision as CB display
    const absDiff = Math.abs(diff);
    // Threshold for showing as 0 based on selected precision
    const zeroThreshold = 1 / Math.pow(10, cbPrecision + 1);
    const diffStr = absDiff < zeroThreshold ? "0." + "0".repeat(cbPrecision) + "%" : (diff > 0 ? "+" : "-") + absDiff.toFixed(cbPrecision) + "%";

    return { 
      cb: cb.toFixed(cbPrecision), 
      set: r.toFixed(cbPrecision), 
      diff: diffStr, 
      diffVal: diff 
    };
  };

  const getSpreadFor = (code: string) => spreads[code] || { buy: '0.000000', sell: '0.000000' };

  // --- EFFECTS ---
  useEffect(() => { localStorage.setItem('p2p_spreads', JSON.stringify(spreads)); }, [spreads]);
  useEffect(() => { localStorage.setItem('p2p_pro_mode', isProMode.toString()); }, [isProMode]);
  useEffect(() => { localStorage.setItem('p2p_calc_mode', calcMode); }, [calcMode]);
  useEffect(() => { localStorage.setItem('p2p_source_curr', sourceCurr); localStorage.setItem('p2p_target_curr', targetCurr); }, [sourceCurr, targetCurr]);

  useEffect(() => {
    const cbBuy = apiRates[sourceCurr];
    const cbSell = apiRates[targetCurr];
    const bVal = p(buyRate);
    const sVal = p(sellRate);
    if (bVal === 0 || sVal === 0) return;
    let hasExtremeSpread = false;
    if (isProMode && cbBuy && cbSell) {
      const bSpread = Math.abs(calculateSpread(bVal, cbBuy));
      const sSpread = Math.abs(calculateSpread(sVal, cbSell));
      if (bSpread > 5 || sSpread > 5) hasExtremeSpread = true;
    }
    if (warningTimer.current) { clearTimeout(warningTimer.current); warningTimer.current = null; }
    if (hasExtremeSpread) {
        if (!warningAcknowledged) {
            warningTimer.current = window.setTimeout(() => setShowWarningPopup(true), 3000);
        }
    } else {
      localStorage.setItem('p2p_last_buy_rate', buyRate);
      localStorage.setItem('p2p_last_sell_rate', sellRate);
      setWarningAcknowledged(false);
      setShowWarningPopup(false);
      setIsCorrectChecked(false);
      setIsSaveChecked(false);
    }
    return () => { if (warningTimer.current) clearTimeout(warningTimer.current); };
  }, [buyRate, sellRate, isProMode, apiRates, sourceCurr, targetCurr, warningAcknowledged]);

  useEffect(() => {
    fetch('https://open.er-api.com/v6/latest/USD')
      .then(res => res.json())
      .then(data => { if (data && data.rates) setApiRates(data.rates); })
      .catch(e => console.error("Rate fetch error", e));
  }, []);

  const recalculateRates = useCallback(() => {
    const cbBuy = apiRates[sourceCurr];
    const cbSell = apiRates[targetCurr];
    if (!cbBuy || !cbSell) return;
    const currencyChanged = lastSource.current !== sourceCurr || lastTarget.current !== targetCurr;
    
    // Default spread is zero for any currency not explicitly configured.
    // Removed the force-switch to 'exact' mode to allow immediate use of 'approx' mode with 0 spread.

    if ((isProMode && calcMode === 'approx') || currencyChanged || p(buyRate) === 0) {
      const sprBuy = getSpreadFor(sourceCurr);
      const sprSell = getSpreadFor(targetCurr);
      const newBuyRate = cbBuy * (1 + parseFloat(sprBuy.buy) / 100);
      const newSellRate = cbSell * (1 + parseFloat(sprSell.sell) / 100);
      const fBuy = fmt(newBuyRate);
      const fSell = fmt(newSellRate);
      setBuyRate(fBuy);
      setSellRate(fSell);
      const buyAmt = p(amountBuy);
      if (buyAmt > 0) {
        const usdt = buyAmt / newBuyRate;
        setAmountUsdt(fmt(usdt));
        setAmountSale(fmt(usdt * newSellRate));
      }
    }
    lastSource.current = sourceCurr;
    lastTarget.current = targetCurr;
  }, [isProMode, calcMode, apiRates, sourceCurr, targetCurr, spreads, configuredCurrencies, amountBuy, buyRate]);

  useEffect(() => { recalculateRates(); }, [recalculateRates]);

  // --- HANDLERS ---
  const handleSaleChange = (val: string) => {
    const formatted = formatInputString(val); setAmountSale(formatted);
    const sRate = p(sellRate); const bRate = p(buyRate); const targetVal = p(formatted);
    if (sRate > 0 && bRate > 0) {
      const usdt = targetVal / sRate; setAmountUsdt(fmt(usdt)); setAmountBuy(fmt(usdt * bRate));
    }
  };

  const handleBuyChange = (val: string) => {
    const formatted = formatInputString(val); setAmountBuy(formatted);
    const sRate = p(sellRate); const bRate = p(buyRate); const sourceVal = p(formatted);
    if (bRate > 0 && sRate > 0) {
      const usdt = sourceVal / bRate; setAmountUsdt(fmt(usdt)); setAmountSale(fmt(usdt * sRate));
    }
  };

  const handleUsdtChange = (val: string) => {
    const formatted = formatInputString(val); setAmountUsdt(formatted);
    const sRate = p(sellRate); const bRate = p(buyRate); const usdtVal = p(formatted);
    if (sRate > 0 && bRate > 0) { setAmountBuy(fmt(usdtVal * bRate)); setAmountSale(fmt(usdtVal * sRate)); }
  };

  const updateRates = (newBuyRate: string, newSellRate: string) => {
    markAsConfigured(sourceCurr); markAsConfigured(targetCurr);
    const formattedBuy = formatInputString(newBuyRate); const formattedSell = formatInputString(newSellRate);
    setBuyRate(formattedBuy); setSellRate(formattedSell);
    const bVal = p(formattedBuy); const sVal = p(formattedSell);
    const cbBuy = apiRates[sourceCurr]; const cbSell = apiRates[targetCurr];
    if (cbBuy && cbSell && bVal > 0 && sVal > 0) {
       setSpreads(prev => ({
          ...prev,
          [sourceCurr]: { ...(prev[sourceCurr] || { buy: '0', sell: '0' }), buy: calculateSpread(bVal, cbBuy).toFixed(6) },
          [targetCurr]: { ...(prev[targetCurr] || { buy: '0', sell: '0' }), sell: calculateSpread(sVal, cbSell).toFixed(6) }
       }));
    }
    const usdt = p(amountUsdt);
    if (usdt > 0) { setAmountBuy(fmt(usdt * bVal)); setAmountSale(fmt(usdt * sVal)); }
  };

  const getFlag = (code: string) => {
      const priority = PRIORITY_CURRENCIES.find(c => c.code === code);
      return priority ? priority.flag : (COMMON_FLAGS[code] || '🏳️');
  };

  const buyInfo = getRateInfo(buyRate, sourceCurr);
  const sellInfo = getRateInfo(sellRate, targetCurr);

  return (
    <div className="min-h-screen w-full bg-[#F2F3F5] text-[#333333] flex flex-col font-sans relative overflow-x-hidden">
      <div className="flex-none px-4 py-4 flex justify-between items-center z-10 bg-[#F2F3F5] sticky top-0">
        <div className="w-[50px]"></div> 
        <span className="text-[17px] font-bold text-black uppercase tracking-wide">P2P Exchanger</span>
        <button onClick={() => setShowSettings(true)} className="w-[50px] flex justify-end text-[#2866E0] active:opacity-60 transition-opacity"><Settings size={24} /></button>
      </div>

      {showWarningPopup && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
           <div className="bg-white w-full max-w-xs rounded-[28px] p-6 relative z-10 animate-in zoom-in-95 duration-200 shadow-2xl flex flex-col">
              <div className="w-14 h-14 bg-rose-50 rounded-full flex items-center justify-center mb-4 mx-auto text-rose-500 shadow-sm border border-rose-100"><AlertTriangle size={30} /></div>
              <p className="text-[16px] font-bold text-gray-900 leading-snug mb-6 text-center">Spread больше 5% проверьте выбранную валюту</p>
              <div className="space-y-4 mb-8">
                 <div className="flex items-center gap-3 cursor-pointer select-none py-1" onClick={() => setIsCorrectChecked(!isCorrectChecked)}>
                   <div className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-all ${isCorrectChecked ? 'bg-rose-600 border-rose-600 shadow-md' : 'bg-[#F2F3F5] border-gray-200'}`}>{isCorrectChecked && <Check size={16} className="text-white" strokeWidth={3} />}</div>
                   <span className={`text-[15px] font-bold transition-colors ${isCorrectChecked ? 'text-gray-900' : 'text-gray-400'}`}>Валюта верная</span>
                 </div>
                 <div className="flex items-center gap-3 cursor-pointer select-none py-1" onClick={() => setIsSaveChecked(!isSaveChecked)}>
                   <div className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-all ${isSaveChecked ? 'bg-rose-600 border-rose-600 shadow-md' : 'bg-[#F2F3F5] border-gray-200'}`}>{isSaveChecked && <Check size={16} className="text-white" strokeWidth={3} />}</div>
                   <span className={`text-[15px] font-bold transition-colors ${isSaveChecked ? 'text-gray-900' : 'text-gray-400'}`}>Запомнить Spread</span>
                 </div>
              </div>
              <button onClick={() => { if(isSaveChecked) { markAsConfigured(sourceCurr); markAsConfigured(targetCurr); } setWarningAcknowledged(true); setShowWarningPopup(false); }} className="w-full py-4 rounded-2xl text-[16px] font-bold shadow-lg transition-all active:scale-[0.97] bg-rose-600 text-white active:bg-rose-700 shadow-rose-200">OK</button>
           </div>
        </div>
      )}

      {isProMode && (
        <div className="flex-none flex items-center justify-center gap-6 pt-4 pb-4 px-4 animate-in slide-in-from-top-2 duration-300">
          <div className="relative group cursor-pointer flex items-center gap-2 bg-[#E5E7EB] rounded-full pl-2 pr-4 py-1.5 shadow-sm">
             <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center overflow-hidden"><span className="text-2xl pt-0.5">{getFlag(sourceCurr)}</span></div>
             <span className="text-[22px] font-bold tracking-tight">{sourceCurr}</span>
             <ChevronDown size={20} className="text-[#999999] mt-1" />
             <select value={sourceCurr} onChange={(e) => setSourceCurr(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">{allAvailableCurrencies.map(c => <option key={c} value={c}>{c}</option>)}</select>
          </div>
          <button onClick={() => { const s = sourceCurr; setSourceCurr(targetCurr); setTargetCurr(s); }} className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm text-[#2866E0] hover:bg-blue-50 transition-colors active:scale-90 shrink-0"><ArrowLeftRight size={20} /></button>
          <div className="relative group cursor-pointer flex items-center gap-2 bg-[#E5E7EB] rounded-full pl-2 pr-4 py-1.5 shadow-sm">
             <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center overflow-hidden"><span className="text-2xl pt-0.5">{getFlag(targetCurr)}</span></div>
             <span className="text-[22px] font-bold tracking-tight">{targetCurr}</span>
             <ChevronDown size={20} className="text-[#999999] mt-1" />
             <select value={targetCurr} onChange={(e) => setTargetCurr(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">{allAvailableCurrencies.map(c => <option key={c} value={c}>{c}</option>)}</select>
          </div>
        </div>
      )}

      {isProMode && (
        <div className="px-4 pb-4 animate-in slide-in-from-top-2 duration-300">
          <div className="bg-[#E5E7EB] p-1 rounded-xl flex text-[14px] font-medium relative">
            <button onClick={() => setCalcMode('approx')} className={`flex-1 py-1.5 rounded-lg transition-all duration-200 ${calcMode === 'approx' ? 'bg-white shadow-sm text-black' : 'text-[#999999]'}`}>Approximate</button>
            <button onClick={() => setCalcMode('exact')} className={`flex-1 py-1.5 rounded-lg transition-all duration-200 ${calcMode === 'exact' ? 'bg-white shadow-sm text-black' : 'text-[#999999]'}`}>Exact</button>
          </div>
        </div>
      )}

      <div className="flex-1 px-4 pb-8 space-y-4">
        <div className="bg-white rounded-[24px] shadow-sm p-4 pt-5 relative transition-all duration-300">
          <div className="grid grid-cols-2 gap-3">
             <div className={`bg-[#F2F3F5] rounded-xl px-3 py-3 flex flex-col justify-center relative ${(isProMode && calcMode === 'approx') ? 'opacity-90' : 'ring-2 ring-[#2866E0] bg-white'}`}>
                <span className="text-[11px] text-[#999999] mb-0.5 flex items-center gap-1">Buy USDT {(isProMode && calcMode === 'approx') && <span className="text-[9px] bg-gray-200 px-1 rounded text-gray-500">Auto</span>}</span>
                <input type="text" inputMode="decimal" value={buyRate} readOnly={isProMode && calcMode === 'approx'} onChange={(e) => updateRates(e.target.value, sellRate)} className="bg-transparent text-[22px] font-semibold text-black outline-none w-full" placeholder="0.00" />
                {isProMode && buyInfo && (
                  <div className="mt-2 pt-2 border-t border-gray-200 text-[10px] space-y-0.5">
                     <div className="flex justify-between text-gray-500"><span>CB Rate:</span><span>{buyInfo.cb}</span></div>
                     <div className="flex justify-between font-medium"><span className="text-gray-500">Spread:</span><span className={Math.abs(buyInfo.diffVal) > 5 ? 'text-rose-600 font-bold' : buyInfo.diffVal >= 0 ? 'text-emerald-600' : 'text-rose-500'}>{buyInfo.diff}</span></div>
                  </div>
                )}
             </div>
             <div className={`bg-[#F2F3F5] rounded-xl px-3 py-3 flex flex-col justify-center relative ${(isProMode && calcMode === 'approx') ? 'opacity-90' : 'ring-2 ring-[#2866E0] bg-white'}`}>
                 <span className="text-[11px] text-[#999999] mb-0.5 flex items-center gap-1">Sell USDT {(isProMode && calcMode === 'approx') && <span className="text-[9px] bg-gray-200 px-1 rounded text-gray-500">Auto</span>}</span>
                 <input type="text" inputMode="decimal" value={sellRate} readOnly={isProMode && calcMode === 'approx'} onChange={(e) => updateRates(buyRate, e.target.value)} className="bg-transparent text-[22px] font-semibold text-black outline-none w-full" placeholder="0.00" />
                {isProMode && sellInfo && (
                  <div className="mt-2 pt-2 border-t border-gray-200 text-[10px] space-y-0.5">
                     <div className="flex justify-between text-gray-500"><span>CB Rate:</span><span>{sellInfo.cb}</span></div>
                     <div className="flex justify-between font-medium"><span className="text-gray-500">Spread:</span><span className={Math.abs(sellInfo.diffVal) > 5 ? 'text-rose-600 font-bold' : sellInfo.diffVal >= 0 ? 'text-emerald-600' : 'text-rose-500'}>{sellInfo.diff}</span></div>
                  </div>
                )}
             </div>
          </div>
        </div>

        <div className="bg-white rounded-[24px] shadow-sm p-4 pt-5 relative">
          <div className="space-y-3">
            <div className="bg-[#F2F3F5] rounded-xl px-4 py-3 flex justify-between items-center gap-3 focus-within:ring-2 focus-within:ring-[#2866E0] transition-all">
               <div className="flex flex-col flex-1 min-w-0"><span className="text-[11px] text-[#999999] font-medium">Give</span><input type="text" inputMode="decimal" value={amountBuy} onChange={(e) => handleBuyChange(e.target.value)} className="bg-transparent text-[26px] font-semibold text-black outline-none w-full" /></div>
               {isProMode && (<div className="flex items-center gap-2 shrink-0"><div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden"><span>{getFlag(sourceCurr)}</span></div><span className="text-[17px] font-medium text-[#999999]">{sourceCurr}</span></div>)}
            </div>
             <div className="bg-[#F2F3F5] rounded-xl px-4 py-3 flex justify-between items-center gap-3 focus-within:ring-2 focus-within:ring-[#2866E0] transition-all">
               <div className="flex flex-col flex-1 min-w-0"><span className="text-[11px] text-[#999999] font-medium">Receive</span><input type="text" inputMode="decimal" value={amountSale} onChange={(e) => handleSaleChange(e.target.value)} className="bg-transparent text-[26px] font-semibold text-black outline-none w-full" /></div>
               {isProMode && (<div className="flex items-center gap-2 shrink-0"><div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden"><span>{getFlag(targetCurr)}</span></div><span className="text-[17px] font-medium text-[#999999]">{targetCurr}</span></div>)}
            </div>
            <div className="bg-[#F2F3F5] rounded-xl px-4 py-3 flex justify-between items-center gap-3 focus-within:ring-2 focus-within:ring-[#2866E0] transition-all">
               <div className="flex flex-col flex-1 min-w-0"><span className="text-[11px] text-[#999999] font-medium">Equivalent</span><input type="text" inputMode="decimal" value={amountUsdt} onChange={(e) => handleUsdtChange(e.target.value)} className="bg-transparent text-[26px] font-semibold text-black outline-none w-full" /></div>
               <div className="flex items-center gap-2 shrink-0"><div className="w-6 h-6 rounded-full bg-teal-500/10 flex items-center justify-center text-teal-600 font-bold">₮</div><span className="text-[17px] font-medium text-[#999999]">USDT</span></div>
            </div>
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
           <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={() => setShowSettings(false)}></div>
           <div className="bg-white w-full max-w-sm rounded-t-[24px] sm:rounded-[24px] p-6 relative z-10 animate-in slide-in-from-bottom-10 shadow-xl flex flex-col">
              <div className="flex justify-between items-center mb-6"><h3 className="text-xl font-bold">Settings</h3><button onClick={() => setShowSettings(false)} className="w-8 h-8 rounded-full bg-[#F2F3F5] flex items-center justify-center text-[#999999]"><X size={20} /></button></div>
              <div className="space-y-4 mb-4">
                  <div className="p-4 bg-[#F9FAFB] rounded-2xl border border-gray-100 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col"><span className="font-bold text-gray-800">Pro Mode</span><span className="text-xs text-gray-500">Show advanced controls and metrics</span></div>
                        <button onClick={() => setIsProMode(!isProMode)} className={`w-14 h-8 rounded-full transition-colors relative ${isProMode ? 'bg-[#2866E0]' : 'bg-gray-300'}`}><div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-transform ${isProMode ? 'translate-x-6' : 'translate-x-0'}`}></div></button>
                      </div>
                      <p className="text-[11px] text-gray-500 italic leading-relaxed mt-2 pt-2 border-t border-gray-100">
                        In Pro mode, P2P Exchanger can calculate an approximate exchange rate. The calculator takes into account the difference between the entered price and the Central Bank exchange rate. When the Central Bank exchange rate changes, the buy and sell prices are updated automatically.
                      </p>
                  </div>
              </div>
              <button onClick={() => setShowSettings(false)} className="w-full mt-2 bg-[#2866E0] text-white font-semibold py-3.5 rounded-xl shadow-lg mb-2">Done</button>
           </div>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);