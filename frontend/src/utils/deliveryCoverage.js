import api from '../api/client'

/**
 * Ask the shared backend coverage engine whether a location is serviceable.
 * The same endpoint is used by web and future mobile clients; no boundary
 * rules are duplicated in the browser.
 */
export async function checkDeliveryCoverage({
  provinceId,
  districtId,
  municipalityId,
  wardId,
  wardNumber,
  lat,
  lng,
  serviceMode = 'standard',
}) {
  const params = {
    province_id: provinceId,
    district_id: districtId || undefined,
    municipality_id: municipalityId || undefined,
    ward_id: wardId || undefined,
    ward_number: wardNumber || undefined,
    lat: lat ?? undefined,
    lng: lng ?? undefined,
    service_mode: serviceMode,
  }

  Object.keys(params).forEach((key) => params[key] === undefined && delete params[key])

  const response = await api.get('/platform/delivery-coverage/check', { params })
  return response.data?.data || null
}

export function coverageMessage(assessment, fallback = 'Delivery is not available for this location.') {
  return assessment?.messages?.find(Boolean) || fallback
}
