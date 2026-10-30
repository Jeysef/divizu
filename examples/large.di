// Atlas Commerce — a deliberately large system map.
// 28 blocks, three roots, one file. Shared providers are drawn once.
//
// Read bottom-up: roots at the bottom, dependencies above. Split by context
// when a plate stops being readable.

root StorefrontApi "customer web + mobile" {
  needs StorefrontCatalog <- CatalogService
  needs Checkout <- CheckoutService
  needs Search <- SearchService
  needs Session
}

component CatalogService "browse and pricing" {
  provides: StorefrontCatalog
  modules: CatalogRepo, PricingRules
  needs Media <- MediaService
}

component CheckoutService "cart to order" {
  provides: Checkout
  modules: CartValidator, TaxCalculator
  needs Payments <- StripePayments
  needs Inventory <- InventoryService
  needs OrderEventsKey <- OrderEvents
}

component SearchService "query and ranking" {
  provides: Search
  modules: QueryParser, Ranker
  needs SearchIndexKey <- SearchIndex
}

component MediaService "image pipeline" {
  provides: Media
  modules: ImagePipeline
  needs MediaBucket <- ObjectStorage
}

component InventoryService "stock reservations" {
  provides: Inventory
  modules: Reservations
  needs InventoryDb <- InventoryDB
}

boundary StripePayments "payments" {
  provides: Payments
  tag: adapter
}

boundary SearchIndex "full-text index" {
  provides: SearchIndexKey
  tag: adapter
}

boundary ObjectStorage "media bucket" {
  provides: MediaBucket
  tag: adapter
}

boundary InventoryDB "postgres" {
  provides: InventoryDb
  tag: adapter
}

boundary OrderEvents "order stream" {
  provides: OrderEventsKey
  tag: adapter
}

root OperatorConsole "internal back office" {
  needs Orders <- OrderAdmin
  needs AdminCatalog <- CatalogAdmin
  needs Customers <- CustomerAdmin
  needs Auth <- StaffIdentity
}

component OrderAdmin "support and refunds" {
  provides: Orders
  modules: OrderSearch, RefundPolicy
  needs Ledger <- LedgerService
}

component CatalogAdmin "merchandising" {
  provides: AdminCatalog
  modules: DraftEditor, PublishGate
  needs Media
}

component CustomerAdmin "accounts and GDPR" {
  provides: Customers
  modules: Segments, ErasureJobs
  needs CRM <- CrmAdapter
}

component StaffIdentity "staff SSO" {
  provides: Auth
  modules: Roles, AuditLog
  needs Directory
}

component LedgerService "double-entry ledger" {
  provides: Ledger
  modules: LedgerEntries
  needs LedgerDb <- LedgerDB
}

boundary CrmAdapter "salesforce" {
  provides: CRM
  tag: adapter
}

boundary LedgerDB "postgres" {
  provides: LedgerDb
  tag: adapter
}

root AsyncWorkers "queue consumers" {
  needs Projections <- OrderProjector
  needs MediaWorker <- MediaWorker
  needs Mail <- EmailWorker
  needs WorkerIndex <- IndexWorker
}

component OrderProjector "read models" {
  provides: Projections
  modules: Idempotency, Retries
  needs Queue <- EventBus
}

component MediaWorker "transcode + thumbs" {
  provides: MediaWorker
  modules: Transcode, Thumbnails
  needs WorkerBucketKey <- WorkerBucket
}

component EmailWorker "transactional mail" {
  provides: Mail
  modules: Templates, RateLimiter
  needs MailProvider <- Postmark
}

component IndexWorker "index maintenance" {
  provides: WorkerIndex
  modules: Batcher, Retry
  needs WorkerIndexKey <- WorkerIndex
}

boundary EventBus "kafka" {
  provides: Queue
  tag: adapter
}

boundary WorkerBucket "S3" {
  provides: WorkerBucketKey
  tag: adapter
}

boundary Postmark "email" {
  provides: MailProvider
  tag: adapter
}

boundary WorkerIndex "opensearch" {
  provides: WorkerIndexKey
  tag: adapter
}
