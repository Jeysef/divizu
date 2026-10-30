// Factories with alternative implementations. A candidate can require an
// interface with Name(Requirement); that becomes a side notch, not a graph edge.

root UploadRequest "upload API" {
  needs Scanner <- ThreatProtectScanner
  needs ImageScaler <- SharpImageScaler
  needs PreviewGenerator <- PreviewGeneratorFactory
  needs Storage <- StorageFactory
}

boundary ThreatProtectScanner "scanner" {
  provides: Scanner
  tag: adapter
}

boundary SharpImageScaler "image scaler" {
  provides: ImageScaler
  tag: adapter
}

component PreviewGeneratorFactory "preview factory" {
  provides: PreviewGenerator
  needs ImageScaler <- SharpImageScaler
  candidates: DocumentPreview, ImagePreview(ImageScaler), VideoPreview
  tag: factory
}

component StorageFactory "storage factory" {
  provides: Storage
  needs Encryption <- AESEncryption
  candidates: S3Storage, AwsStorage(Encryption), WebDavStorage
  tag: factory
}

component AESEncryption "AES" {
  provides: Encryption
  needs Key <- KeyService
}

component KeyService "key service" {
  provides: Key
}
