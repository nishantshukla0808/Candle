'use client';

export default function CandleLogo({ size = 32, showText = false, className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Flame */}
        <ellipse cx="20" cy="5" rx="5" ry="5.5" fill="#FF9600" />
        <ellipse cx="20" cy="3.5" rx="3" ry="3.5" fill="#FFD700" />
        <ellipse cx="20" cy="2.5" rx="1.5" ry="2" fill="#FFF" opacity="0.6" />
        {/* Wick */}
        <rect x="19" y="9" width="2" height="4" rx="1" fill="#46A302" />
        {/* Candle body (bullish green) */}
        <rect x="14" y="13" width="12" height="16" rx="2.5" fill="#58CC02" />
        {/* Body highlight */}
        <rect x="16" y="15" width="3" height="12" rx="1.5" fill="rgba(255,255,255,0.2)" />
        {/* Lower wick */}
        <rect x="19" y="29" width="2" height="5" rx="1" fill="#46A302" />
        {/* Chart line behind */}
        <polyline points="3,33 9,27 15,30 25,19 31,23 37,15" stroke="rgba(28,176,246,0.25)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
      {showText && (
        <span className="text-lg font-black" style={{ color: '#58CC02' }}>CANDLE</span>
      )}
    </div>
  );
}
