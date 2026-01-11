'use client';

import { useState } from 'react';

export default function SettingsPage() {
  // Mock settings for now - in production these would persist to DB/Env
  const [useTestnet, setUseTestnet] = useState(true);
  const [notifications, setNotifications] = useState(true);

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-white">System Settings</h2>
      
      <div className="space-y-6 max-w-2xl">
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
            <h3 className="text-xl font-semibold text-white mb-4">Exchange Configuration</h3>
            
            <div className="flex items-center justify-between py-4 border-b border-slate-700">
                <div>
                    <p className="text-white font-medium">Use Binance Testnet URLs</p>
                    <p className="text-sm text-slate-400">Force all Binance connections to use testnet.binancefuture.com</p>
                </div>
                <div 
                    onClick={() => setUseTestnet(!useTestnet)}
                    className={`w-14 h-8 rounded-full cursor-pointer relative transition-colors ${useTestnet ? 'bg-emerald-500' : 'bg-slate-600'}`}
                >
                    <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${useTestnet ? 'left-7' : 'left-1'}`} />
                </div>
            </div>

            <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded text-yellow-200 text-sm">
                To use Testnet, ensure you have provided <strong>Testnet API Keys</strong> in your Strategy configuration.
            </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
            <h3 className="text-xl font-semibold text-white mb-4">Notifications</h3>
             <div className="flex items-center justify-between py-4">
                <div>
                    <p className="text-white font-medium">Telegram Notifications</p>
                    <p className="text-sm text-slate-400">Receive trade alerts via Telegram bot</p>
                </div>
                <div 
                    onClick={() => setNotifications(!notifications)}
                    className={`w-14 h-8 rounded-full cursor-pointer relative transition-colors ${notifications ? 'bg-emerald-500' : 'bg-slate-600'}`}
                >
                    <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${notifications ? 'left-7' : 'left-1'}`} />
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
