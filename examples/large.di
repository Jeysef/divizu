// Atlas Commerce — a deliberately large system map.
// 28 blocks, three roots, five bounded contexts. One file, no duplicated
// subtrees. Split further by context if you need a closer read.
//
// Bottom-up: roots sit at the bottom, sockets open upward.

StorefrontApi "customer web + mobile" {
  role: root
  socket Catalog <- CatalogService
  socket Checkout <- CheckoutService
  socket Search <- SearchService
  socket Session
}

CatalogService "browse and pricing" {
  role: composite
  modules: CatalogRepo, PricingRules
  socket Media <- MediaService
}

CheckoutService "cart to order" {
  role: composite
  modules: CartValidator, TaxCalculator
  socket Payments <- StripePayments
  socket Inventory <- InventoryService
  socket Orders <- OrderEvents
}

SearchService "query and ranking" {
  role: composite
  modules: QueryParser, Ranker
  socket Index <- SearchIndex
}

MediaService "image pipeline" {
  role: composite
  modules: ImagePipeline
  socket Bucket <- ObjectStorage
}

InventoryService "stock reservations" {
  role: composite
  modules: Reservations
  socket DB <- InventoryDB
}

StripePayments "payments" { role: adapter }
SearchIndex "full-text index" { role: adapter }
ObjectStorage "media bucket" { role: adapter }
InventoryDB "postgres" { role: adapter }
OrderEvents "order stream" { role: adapter }

OperatorConsole "internal back office" {
  role: root
  socket Orders <- OrderAdmin
  socket Catalog <- CatalogAdmin
  socket Customers <- CustomerAdmin
  socket Auth <- StaffIdentity
}

OrderAdmin "support and refunds" {
  role: composite
  modules: OrderSearch, RefundPolicy
  socket Ledger <- LedgerService
}

CatalogAdmin "merchandising" {
  role: composite
  modules: DraftEditor, PublishGate
  socket Media
}

CustomerAdmin "accounts and GDPR" {
  role: composite
  modules: Segments, ErasureJobs
  socket CRM <- CrmAdapter
}

StaffIdentity "staff SSO" {
  role: service
  modules: Roles, AuditLog
  socket Directory
}

LedgerService "double-entry ledger" {
  role: service
  modules: LedgerEntries
  socket DB <- LedgerDB
}

CrmAdapter "salesforce" { role: adapter }
LedgerDB "postgres" { role: adapter }

AsyncWorkers "queue consumers" {
  role: root
  socket Projections <- OrderProjector
  socket Media <- MediaWorker
  socket Mail <- EmailWorker
  socket Index <- IndexWorker
}

OrderProjector "read models" {
  role: composite
  modules: Idempotency, Retries
  socket Queue <- EventBus
}

MediaWorker "transcode + thumbs" {
  role: composite
  modules: Transcode, Thumbnails
  socket Bucket <- WorkerBucket
}

EmailWorker "transactional mail" {
  role: composite
  modules: Templates, RateLimiter
  socket Provider <- Postmark
}

IndexWorker "index maintenance" {
  role: composite
  modules: Batcher, Retry
  socket Index <- WorkerIndex
}

EventBus "kafka" { role: adapter }
WorkerBucket "S3" { role: adapter }
Postmark "email" { role: adapter }
WorkerIndex "opensearch" { role: adapter }
