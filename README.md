# Thrift Store: Cleaning ASMR

Game web của Falcon, khung chuẩn: Vite + TypeScript + `@falcongames/game-client-sdk`.
Làm lại từ bản Unity (IL2CPP) bằng asset, dữ liệu và thông số tween trích từ file xapk.

```bash
npm install
npm run dev      # hoặc mở Preview trong Falcon IDE
npm run build    # dist/index.html — một tệp duy nhất
```

- **Mỗi level là một món đồ** (80 level, thứ tự cố định): lau 4 bước (Brush → Sprayer → Hose → Towel), rồi bán qua
  mặc cả hoặc giữ trưng bày. `levelStart` khi món đồ sẵn sàng, `win` khi bán/giữ xong. Không có `lose`.
- `src/game.ts` thực hiện hợp đồng `FalconGame`; toàn bộ gameplay ở `src/engine.js`.
- Asset ở `src/assets/` (ảnh webp, mp3, font Fredoka, `data.json`) đều đi qua `import.meta.glob` để build nhúng vào một file.
- Quảng cáo "Watch Ad" và shop coin/gem trong game hiện là giả lập; khi cần thì nối vào `SDK.ads` / `SDK.shop` (xem `CLAUDE.md`).
- `gameId` của SDK KHÔNG nằm trong source: lúc Publish, Falcon IDE đặt nó bằng **package name** của game
  (`VITE_FALCON_GAME_ID`). Lúc develop nó là `dev`.
- Số liệu của lớp studio (coin thắng, giá hồi sinh, cổng ads, lives…) đặt trong `.falcon/sdk-config.json`.

## Build tự động (GitHub Actions)

Mỗi lần push lên `main`, workflow `.github/workflows/build.yml` sẽ:

- build web → đẩy `index.html` lên nhánh `gh-pages` (bật **Settings → Pages → Branch: `gh-pages`** để chơi online);
- đóng gói APK Android bằng Capacitor (`capacitor.config.json`, thư mục `android/` sinh ra trong CI);
- gắn `ThriftStore.apk` và `ThriftStore-web.zip` vào Release **`latest`**.

APK là bản debug-signed, cài thẳng được để thử; muốn lên Google Play cần thêm keystore release.
