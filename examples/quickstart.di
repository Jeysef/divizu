// A compact example used on the landing page and in the playground.

root CheckoutApi "root" {
  needs Orders <- OrderService
  needs Telemetry
  needs Catalog <- PostgresCatalog
  needs Config <- AppConfig
}

component OrderService "application service" {
  provides: Orders
  modules: ValidateCart, PriceOrder
  needs Payments <- StripeGateway
}

boundary StripeGateway "payments" {
  provides: Payments
  tag: adapter
}

boundary PostgresCatalog "catalog database" {
  provides: Catalog
  modules: "conn pool"
  tag: adapter
}

value AppConfig "context" {
  provides: Config
  tag: config
}
