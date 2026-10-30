// Shared dependencies are drawn once and wired to every consumer.
// Use `needs Key <- fresh Provider` when a consumer needs its own instance.

root Api "application" {
  needs Orders <- OrdersLive
  needs Health <- HealthLive
}

component OrdersLive "order service" {
  provides: Orders
  needs Db <- DbLive
  needs Logger <- LoggerLive
}

component HealthLive "health service" {
  provides: Health
  needs Db <- DbLive
  needs Logger <- LoggerLive
  needs Clock
}

boundary DbLive "postgres" {
  provides: Db
  needs Config <- AppConfig
  tag: closer
}

boundary LoggerLive "structured logs" {
  provides: Logger
  tag: singleton
}

value AppConfig "config" {
  provides: Config
  tag: config
}
