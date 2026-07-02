'use client';

import { useState } from 'react';

export default function SettingsPage() {
  const [useTestnet, setUseTestnet] = useState(true);
  const [notifications, setNotifications] = useState(true);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-foreground">Configurações</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Configurações gerais do sistema</p>
      </div>

      <div className="space-y-4 max-w-2xl">
        <div className="bg-card/60 rounded-lg border border-border/60 backdrop-blur-sm">
          <div className="px-4 py-3 border-b border-border/40">
            <h3 className="text-sm font-semibold text-foreground">Configuração da Exchange</h3>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm text-foreground font-medium">Usar URLs Testnet da Binance</p>
                <p className="text-xs text-muted-foreground mt-0.5">Forçar todas as conexões Binance para testnet.binancefuture.com</p>
              </div>
              <Toggle checked={useTestnet} onChange={() => setUseTestnet(!useTestnet)} />
            </div>

            <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/15 rounded-md">
              <p className="text-yellow-300 text-[11px]">
                Para usar Testnet, certifique-se de fornecer <strong>API Keys de Testnet</strong> na configuração da estratégia.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-card/60 rounded-lg border border-border/60 backdrop-blur-sm">
          <div className="px-4 py-3 border-b border-border/40">
            <h3 className="text-sm font-semibold text-foreground">Notificações</h3>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm text-foreground font-medium">Notificações Telegram</p>
                <p className="text-xs text-muted-foreground mt-0.5">Receber alertas de trades via bot do Telegram</p>
              </div>
              <Toggle checked={notifications} onChange={() => setNotifications(!notifications)} />
            </div>
          </div>
        </div>

        <div className="bg-card/60 rounded-lg border border-border/60 backdrop-blur-sm">
          <div className="px-4 py-3 border-b border-border/40">
            <h3 className="text-sm font-semibold text-foreground">Sistema</h3>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Versão</span>
              <span className="font-mono text-foreground">1.0.0</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Ambiente</span>
              <span className="font-mono text-foreground">{process.env.NODE_ENV}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">API URL</span>
              <span className="font-mono text-foreground text-[10px] truncate max-w-[200px]">{process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${
        checked ? 'bg-primary/60' : 'bg-secondary border border-border/40'
      }`}
    >
      <div className={`absolute top-1 w-4 h-4 bg-foreground rounded-full transition-all ${
        checked ? 'left-6' : 'left-1'
      }`} />
    </button>
  );
}
