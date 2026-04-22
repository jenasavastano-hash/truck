import api from '../api';

export async function createCallbackLead(payload) {
  const response = await api.post('/crm/callback', payload);
  return response.data;
}

export async function getCallbackLeads() {
  const response = await api.get('/crm/callback');
  return response.data;
}

export async function updateCallbackLeadStatus(id, payload) {
  const response = await api.patch(`/crm/callback/${id}`, payload);
  return response.data;
}
