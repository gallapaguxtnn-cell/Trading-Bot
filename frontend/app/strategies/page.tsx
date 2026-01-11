'use client';

import { useState, useEffect } from 'react';
import { Table } from '@/components/ui/Table';
import { Input, Select } from '@/components/ui/Form';
import { fetchStrategies, createStrategy, updateStrategy, deleteStrategy } from '@/lib/api';

const DEFAULT_FORM_DATA = {
    name: 'New Strategy',
    asset: 'BTCUSDT',
    direction: 'LONG',
    leverage: 10,
    marginMode: 'ISOLATED',
    stopLoss: 1.5,
    isDryRun: true,
    isTestnet: false,
    apiKey: '',
    apiSecret: ''
};

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(DEFAULT_FORM_DATA);

  useEffect(() => {
    loadStrategies();
  }, []);

  async function loadStrategies() {
    try {
      const data = await fetchStrategies();
      setStrategies(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(strategy: any) {
      setEditingId(strategy.id);
      setFormData({
          name: strategy.name,
          asset: strategy.asset,
          direction: strategy.direction,
          leverage: strategy.leverage,
          marginMode: strategy.marginMode,
          stopLoss: strategy.stopLossPercentage,
          isDryRun: strategy.isDryRun,
          isTestnet: strategy.isTestnet,
          apiKey: '', // Don't show encrypted keys
          apiSecret: ''
      });
      // Scroll to form
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  async function handleDelete(id: string) {
      if(!confirm('Are you sure you want to delete this strategy?')) return;
      try {
          await deleteStrategy(id);
          loadStrategies();
      } catch (err) {
          console.error(err);
          alert('Failed to delete strategy');
      }
  }

  function handleCancel() {
      setEditingId(null);
      setFormData(DEFAULT_FORM_DATA);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    // Prepare payload MATCHING BACKEND ENTITY
    const payload: any = {
        name: formData.name,
        asset: formData.asset,
        direction: formData.direction,
        leverage: Number(formData.leverage),
        marginMode: formData.marginMode,
        stopLossPercentage: Number(formData.stopLoss), // Fix: Map stopLoss -> stopLossPercentage
        isDryRun: formData.isDryRun,
        isTestnet: formData.isTestnet,
        isActive: true, // Always active on save
    };

    // Only add keys if they are not empty (to avoid overwriting with blank)
    if (formData.apiKey) payload.apiKey = formData.apiKey;
    if (formData.apiSecret) payload.apiSecret = formData.apiSecret;

    try {
        if (editingId) {
            await updateStrategy(editingId, payload);
        } else {
            await createStrategy(payload);
        }
        
        loadStrategies(); 
        handleCancel();
        alert(editingId ? 'Strategy Updated!' : 'Strategy Created!');
    } catch (err) {
        console.error(err);
        alert('Failed to save strategy');
    }
  }

  const handleChange = (e: any) => {
      const { name, value, type, checked } = e.target;
      setFormData(prev => ({
          ...prev,
          [name]: type === 'checkbox' ? checked : value
      }));
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold text-white">Strategy Management</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Strategy List */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 h-fit">
          <h3 className="text-xl font-semibold mb-4 text-white">Active Strategies</h3>
          {loading ? <p className="text-slate-400">Loading...</p> : (
            <Table 
                data={strategies}
                columns={[
                    { header: 'Name', accessor: 'name', className: 'font-bold' },
                    { header: 'Asset', accessor: 'asset' },
                    { 
                        header: 'Mode', 
                        accessor: (s) => (
                            <div className="flex flex-col text-xs">
                                <span className={s.isDryRun ? 'text-yellow-400' : 'text-emerald-400'}>
                                    {s.isDryRun ? 'DRY RUN' : 'REAL'}
                                </span>
                                {s.isTestnet && !s.isDryRun && <span className="text-blue-400">TESTNET</span>}
                            </div>
                        ) 
                    },
                    {
                        header: 'Actions',
                        accessor: (s) => (
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => handleEdit(s)}
                                    className="text-xs bg-slate-700 hover:bg-blue-600 px-2 py-1 rounded text-white transition"
                                >
                                    Edit
                                </button>
                                <button 
                                    onClick={() => handleDelete(s.id)}
                                    className="text-xs bg-slate-700 hover:bg-rose-600 px-2 py-1 rounded text-white transition"
                                >
                                    Del
                                </button>
                                <button 
                                    onClick={() => {
                                        const payload = {
                                            secret: "default_secret_123",
                                            strategyId: s.id,
                                            symbol: s.asset,
                                            action: "{{strategy.order.action}}",
                                            price: "{{close}}"
                                        };
                                        navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                                        alert('Webhook JSON copied!');
                                    }}
                                    className="text-xs bg-slate-700 hover:bg-emerald-600 px-2 py-1 rounded text-white transition"
                                >
                                    Copy JSON
                                </button>
                            </div>
                        )
                    }
                ]}
            />
          )}
        </div>

        {/* Strategy Editor Form */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-semibold text-white">
                {editingId ? `Editing: ${formData.name}` : 'Create New Strategy'}
            </h3>
            {editingId && (
                <button onClick={handleCancel} className="text-sm text-slate-400 hover:text-white">
                    Cancel (Create New)
                </button>
            )}
          </div>
          
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1">
                <label className="text-sm font-medium text-slate-300">Strategy Name</label>
                <input name="name" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" value={formData.name} onChange={handleChange} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-300">Asset</label>
                <input name="asset" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" value={formData.asset} onChange={handleChange} />
              </div>
              
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-300">Direction</label>
                <select name="direction" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" value={formData.direction} onChange={handleChange}>
                    <option value="LONG">LONG</option>
                    <option value="SHORT">SHORT</option>
                    <option value="BOTH">BOTH</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-1">
                <label className="text-sm font-medium text-slate-300">Leverage</label>
                <input type="number" name="leverage" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" value={formData.leverage} onChange={handleChange} />
              </div>

               <div className="space-y-1">
                <label className="text-sm font-medium text-slate-300">Margin</label>
                <select name="marginMode" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" value={formData.marginMode} onChange={handleChange}>
                    <option value="ISOLATED">ISOLATED</option>
                    <option value="CROSS">CROSS</option>
                </select>
              </div>
            </div>

            <div className="bg-slate-900 p-4 rounded border border-slate-700 space-y-4">
                <div className="flex justify-between items-center">
                    <h4 className="text-white font-medium">Exchange Keys (Binance)</h4>
                    {editingId && <span className="text-xs text-emerald-400 font-mono">Keys are stored securely</span>}
                </div>
                {editingId && <p className="text-xs text-slate-400">Only fill these fields if you want to UPDATE your keys.</p>}
                
                <div className="grid grid-cols-1 gap-4">
                    <input name="apiKey" placeholder={editingId ? "Update API Key (Optional)" : "API Key"} className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-white" value={formData.apiKey} onChange={handleChange} />
                    <input type="password" name="apiSecret" placeholder={editingId ? "Update API Secret (Optional)" : "API Secret"} className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-white" value={formData.apiSecret} onChange={handleChange} />
                </div>
                
                <div className="flex items-center gap-2">
                    <input type="checkbox" name="isDryRun" className="w-4 h-4 accent-emerald-500" checked={formData.isDryRun} onChange={handleChange} />
                    <label className="text-sm text-slate-300">Dry Run Mode (Simulate Only)</label>
                </div>
                <div className="flex items-center gap-2">
                    <input type="checkbox" name="isTestnet" className="w-4 h-4 accent-emerald-500" checked={formData.isTestnet} onChange={handleChange} />
                    <label className="text-sm text-slate-300">Use Binance Testnet</label>
                </div>
            </div>

            {/* Risk Management */}
            <div className="border-t border-slate-700 pt-4 mt-4">
                <h4 className="text-white font-medium mb-3">Risk Management</h4>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <label className="text-sm font-medium text-slate-300">Stop Loss (%)</label>
                        <input type="number" step="0.1" name="stopLoss" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" value={formData.stopLoss} onChange={handleChange} />
                    </div>
                </div>
            </div>

            <button className={`w-full font-bold py-3 rounded mt-4 transition transform active:scale-95 text-white ${editingId ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'}`}>
                {editingId ? 'Update Configuration' : 'Create Strategy'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
