// A compact example used on the landing page and in the playground.
// It shows a root, a composite, two adapters and a context value.

CheckoutApi "root" {
  role: root
  socket Orders <- OrderService
  socket Telemetry
  socket Catalog <- PostgresCatalog
  socket Config <- AppConfig
}

OrderService "composite" {
  role: composite
  modules: ValidateCart, PriceOrder
  socket Payments <- StripeAdapter
}

StripeAdapter { role: adapter }

PostgresCatalog "adapter" {
  modules: "conn pool"
}

AppConfig "context" { role: context }
