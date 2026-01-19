const getApiUrl = () => {
  const url = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  if (url.startsWith('http')) return url;
  return `https://${url}`;
};

const API_URL = getApiUrl();

export async function fetchStrategies() {
  const res = await fetch(`${API_URL}/api/strategies`, {
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('Failed to fetch strategies');
  return res.json();
}

export async function createStrategy(data: any) {
  const res = await fetch(`${API_URL}/api/strategies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create strategy');
  return res.json();
}

export async function updateStrategy(id: string, data: any) {
  const res = await fetch(`${API_URL}/api/strategies/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update strategy');
  return res.json();
}

export async function deleteStrategy(id: string) {
  const res = await fetch(`${API_URL}/api/strategies/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete strategy');
}

export async function pauseStrategy(id: string) {
  const res = await fetch(`${API_URL}/api/strategies/${id}/pause`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to pause strategy');
  return res.json();
}

export async function resumeStrategy(id: string) {
  const res = await fetch(`${API_URL}/api/strategies/${id}/resume`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to resume strategy');
  return res.json();
}

export async function resetSingleMode(id: string) {
  const res = await fetch(`${API_URL}/api/strategies/${id}/reset-single`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to reset single mode');
  return res.json();
}

export async function pauseAllStrategies() {
  const res = await fetch(`${API_URL}/api/strategies/pause-all`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to pause all strategies');
  return res.json();
}

export async function resumeAllStrategies() {
  const res = await fetch(`${API_URL}/api/strategies/resume-all`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to resume all strategies');
  return res.json();
}

export async function closeAllPositions() {
  const res = await fetch(`${API_URL}/api/trades/close-all`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to close all positions');
  return res.json();
}

export async function closePosition(tradeId: string) {
  const res = await fetch(`${API_URL}/api/trades/close/${tradeId}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to close position');
  return res.json();
}
