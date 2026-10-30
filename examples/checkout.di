// The canonical example from the renderer spec.
// Blocks read bottom-up: root container at the bottom, implementations above.

CheckoutApi "DI container (root)" {
  role: root
  modules: ServiceRegistry, ConfigLoader, LifecycleHooks
  socket ShippingPort
  socket OrderUseCase <- OrderService
  socket ReportPort
}

OrderService "composite" {
  role: composite
  modules: OrderValidator, PricingEngine, OrderMapper
  socket PaymentPort <- StripePayment
  socket StockPort <- PostgresStock
  socket NotifyPort <- EmailNotifier
}

StripePayment "adapter" {
  role: adapter
}

PostgresStock "adapter" {
  role: adapter
  modules: "conn pool", migrations
}

EmailNotifier "adapter" {
  role: adapter
}
