'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { advanceDealStage, markDealLost, markDealWon } from '@/app/actions/growth';
import { DealStage } from '@/lib/types';

const NEXT_STAGE: Record<string, string> = {
  '报价': '样品',
  '样品': '试单',
  '试单': '大货',
};

interface Props {
  dealId: string;
  stage: DealStage;
  status: string;
}

export default function DealActions({ dealId, stage, status }: Props) {
  const router = useRouter();
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [isLosing, setIsLosing] = useState(false);
  const [isWinning, setIsWinning] = useState(false);
  const [showLostForm, setShowLostForm] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (status !== 'active') return null;

  const nextStage = NEXT_STAGE[stage];
  const isFinalStage = stage === '大货';

  const handleAdvance = async () => {
    setIsAdvancing(true);
    setError(null);
    const res = await advanceDealStage(dealId);
    if (res.error) setError(res.error);
    else router.refresh();
    setIsAdvancing(false);
  };

  const handleLost = async () => {
    if (!lostReason.trim()) return;
    setIsLosing(true);
    setError(null);
    const res = await markDealLost(dealId, lostReason.trim());
    if (res.error) setError(res.error);
    else {
      setShowLostForm(false);
      setLostReason('');
      router.refresh();
    }
    setIsLosing(false);
  };

  const handleWon = async () => {
    setIsWinning(true);
    setError(null);
    const res = await markDealWon(dealId);
    if (res.error) setError(res.error);
    else router.refresh();
    setIsWinning(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {/* Advance stage or Win */}
        {isFinalStage ? (
          <button
            onClick={handleWon}
            disabled={isWinning}
            className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
          >
            {isWinning ? '...' : '赢单'}
          </button>
        ) : nextStage ? (
          <button
            onClick={handleAdvance}
            disabled={isAdvancing}
            className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
          >
            {isAdvancing ? '...' : `→ ${nextStage}`}
          </button>
        ) : null}

        {/* Lost toggle */}
        {!showLostForm && (
          <button
            onClick={() => setShowLostForm(true)}
            className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 whitespace-nowrap"
          >
            丢单
          </button>
        )}
      </div>

      {/* Lost reason form */}
      {showLostForm && (
        <div className="flex items-center gap-1.5">
          <input
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder="丢单原因"
            className="text-xs border border-gray-300 rounded px-2 py-1 w-28 focus:outline-none focus:ring-1 focus:ring-red-400"
            onKeyDown={(e) => e.key === 'Enter' && handleLost()}
          />
          <button
            onClick={handleLost}
            disabled={isLosing || !lostReason.trim()}
            className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isLosing ? '...' : '确认'}
          </button>
          <button
            onClick={() => { setShowLostForm(false); setLostReason(''); setError(null); }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            取消
          </button>
        </div>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
