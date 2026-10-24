// The only business functions a seller's browser may invoke on the server.
// `true` marks writes. Anything not listed (data resets, trusted hooks,
// status changes) is unreachable over the network.
export const RPC_METHODS = {
  getSeller: false,
  updateSeller: true,
  listProducts: false,
  getProduct: false,
  saveProduct: true,
  setProductAvailability: true,
  archiveProduct: true,
  adjustStock: true,
  listAdjustments: false,
  applyInventoryCsv: true,
  listOrders: false,
  getOrder: false,
  transitionOrder: true,
  markItemUnavailable: true,
  getLedger: false,
  listSettlements: false,
  listPayoutRequests: false,
  getCommissionRules: false,
  requestPayout: true,
  listReviews: false,
  replyToReview: true,
  reportReview: true,
  listDocuments: false,
  listNotifications: false,
  markNotificationsRead: true,
  getDashboard: false,
} as const;

/** Checkout and delivery stand-ins, enabled on the server only with DEMO_TOOLS=1. */
export const DEMO_RPC_METHODS = {
  _demoSimulateNewOrder: true,
  _demoAdvanceDelivery: true,
} as const;

export type RpcName = keyof typeof RPC_METHODS | keyof typeof DEMO_RPC_METHODS;
