// Reference hardware-slot metaphor: factories with vertical candidate cards.
// Side sockets such as ImagePreview(ImageScaler) and AwsStorage(Encryption)
// render as U-shaped notches with rotated pills.

UploadRequest "root" {
  role: root
  socket Scanner <- ThreatProtectScanner
  socket ImageScaler <- SharpImageScaler
  socket PreviewGenerator <- PreviewGeneratorFactory
  socket Storage <- StorageFactory
}

ThreatProtectScanner { role: adapter }

SharpImageScaler { role: adapter }

PreviewGeneratorFactory "factory" {
  role: service
  socket ImageScaler <- SharpImageScaler
  candidates: DocumentPreview, ImagePreview(ImageScaler), VideoPreview
}

StorageFactory "factory" {
  role: service
  socket Encryption <- AESEncryption
  candidates: S3Storage, AwsStorage(Encryption), WebDavStorage
}

AESEncryption {
  role: service
  socket Key <- KeyService
}

KeyService { role: adapter }
