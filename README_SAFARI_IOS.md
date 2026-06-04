# ForeverShoppers Coupons – iOS Safari Web Extension

Bu paket, Chrome extension dosyalarından iOS Safari Web Extension proje yapısına çevrilmiştir.

## Bundle ID önerisi
- App: `com.forevershoppers.coupons`
- Extension: `com.forevershoppers.coupons.Extension`

## Xcode 16.2 ile açma
1. `ForeverShoppersSafari.xcodeproj` dosyasını aç.
2. Team seç.
3. App ve Extension target bundle identifier değerlerini Apple Developer hesabındaki değerlerle eşleştir.
4. iPhone simulator veya gerçek cihazda çalıştır.
5. iPhone’da: Settings → Safari → Extensions → ForeverShoppers Coupons → Enable.

## Notlar
- Chrome tarafındaki `popup.html`, `popup.js`, `content.js`, `background.js` dosyaları `ForeverShoppers Extension/Resources` içine taşındı.
- Safari/browser uyumu için JS dosyalarının başına küçük `chrome/browser` compatibility shim eklendi.
- App Store gönderiminde iki provisioning profile gerekir: App target ve Extension target.

## Codemagic
Örnek `codemagic.yaml` dosyası pakete eklendi. `DEVELOPMENT_TEAM` değerini kendi Apple Developer Team ID ile değiştir.


App Store validation note:
- App Store upload now requires iOS 26 SDK / Xcode 26 or later. Use Codemagic with `xcode: 26.4` or newer.
- Extension Info.plist includes `CFBundleDisplayName = ForeverShoppers Coupons`.
