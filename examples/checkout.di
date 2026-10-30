// Checkout — root, component, boundaries and an unbound port.
// The root sits at the bottom; dependencies are wired above it.

root CheckoutApi "DI container" {
  needs ShippingPort
  needs OrderUseCase <- OrderService
  needs ReportPort
}

component OrderService "application service" {
  provides: OrderUseCase
  modules: OrderValidator, PricingEngine, OrderMapper
  needs PaymentPort <- StripePayment
  needs StockPort <- PostgresStock
  needs NotifyPort <- EmailNotifier
}

boundary StripePayment "payments" {
  provides: PaymentPort
  tag: adapter
}

boundary PostgresStock "stock database" {
  provides: StockPort
  modules: "conn pool", migrations
  tag: adapter
}

boundary EmailNotifier "transactional mail" {
  provides: NotifyPort
  tag: adapter
}
