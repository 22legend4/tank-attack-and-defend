# Tank: Bảo vệ lõi năng lượng

Game web 2D dành cho màn hình ngang mobile. Không cần cài thư viện.

## Chạy game

Chạy máy chủ phòng tại thư mục dự án:

```powershell
node server.js
```

Sau đó mở `http://localhost:4173`. Người chơi khác trong cùng mạng có thể mở địa chỉ IP của máy chủ với cổng `4173`.

## Android / Google Play

- App ID: `com.tankad.game`
- Build web assets và đồng bộ Android: `npm run android:sync`
- Dự án Android nằm trong thư mục `android/` và được khóa ở chế độ ngang.
- Bản Android đóng gói tài nguyên game; chế độ online kết nối tới `https://tankad.onrender.com`.

## Chế độ chơi

- `Play vs AI`: chơi ngay với máy tính.
- Trong giây đầu của trận đấu với AI, xe tăng AI bắn ngẫu nhiên 1–3 đạn thường. Sau đó, mỗi phát đạn thường từ xe tăng người chơi được AI bắn đáp lại một phát cùng thời điểm; đạn tự động của lính không được tính.
- Khi xe tăng người chơi bị phá hủy, xe tăng AI chuyển sang bắn đạn thường tự do với nhịp ngẫu nhiên. Khi xe tăng người chơi hồi sinh, AI quay lại cơ chế bắn theo người chơi.
- Cứ mỗi 5 giây, nếu xe tăng AI còn hoạt động, nó bắn thêm ngẫu nhiên 1 hoặc 2 đạn thường liên tiếp; hai phát trong cùng đợt cách nhau 0,16 giây.
- AI chỉ dùng `Destroy` khi số đạn của người chơi đã vượt qua giữa sân sang phần sân AI lớn hơn tổng số đạn hiện có của AI.
- AI chỉ dùng `Reflect` khi mục tiêu gần lõi nhất là Laser hoặc Black Hole. Khi hết `Reflect`, AI mới dùng `Shield` để chặn hai loại này; AI cũng dùng `Shield` khi gặp Triple Shot.
- `Create Room`: chọn `Private Room` để tạo phòng riêng có ID, hoặc `Public Room` để tạo phòng chờ ghép ngẫu nhiên.
- Nếu phòng public chỉ có chủ phòng và chờ quá 1 phút, chủ phòng được đưa thẳng vào trận đấu với AI. Phòng private không áp dụng thời hạn này.
- `Join Room`: chọn `Private Room` để nhập ID phòng riêng, hoặc `Public Room` để tự động tìm một phòng công khai đang chờ.
- Màu đội của người chơi được chọn ngẫu nhiên khi trận bắt đầu; người còn lại nhận màu đối diện.
- Phòng và trận đấu tồn tại trong bộ nhớ của máy chủ; khi dừng `server.js`, các phòng sẽ đóng.

## Luật đang được triển khai

- Mỗi bên có xe tăng 1 máu, lõi năng lượng 10 máu và 400 đạn thường.
- Đạn thường bay từ xe tăng đến lõi trong khoảng 8 giây và triệt tiêu đạn thường đối phương.
- Tốn 10 đạn để triệu hồi một lính vào vị trí trên hoặc dưới ngẫu nhiên; tối đa hai lính.
- Mỗi lính bắn một đạn thường mỗi giây và dùng kho đạn chung.
- Đổi máu lõi: 1 máu lấy 5 đạn; 1 máu phá một lính; 2 máu gây 1 sát thương lõi địch.
- Xe tăng bị phá hủy có thể hồi sinh bằng 4 máu lõi.
- Có đầy đủ Lazer, Hố đen, Destroy, Đạn phân 3, Phản ngược, Khiên phòng ngự và Pháo theo số lượng đã chốt.
- Phản ngược tác động vào viên đạn hợp lệ gần lõi nhất; hòa khoảng cách thì chọn ngẫu nhiên. Bấm khi không có mục tiêu vẫn mất lượt dùng.
- Khiên phòng ngự tồn tại 2 giây và bảo vệ lõi năng lượng, xe tăng cùng cả hai lính.
- Mỗi bên có 10 Đạn phân 3. Ngoài việc tách thành ba viên ở giữa sân, chúng có đặc tính va chạm như đạn thường: gặp đạn thường hoặc Đạn phân 3 đối phương thì cả hai cùng bị phá hủy.

Đối thủ đang dùng bộ điều khiển tự động để bản thử nghiệm có thể chơi ngay mà chưa cần máy chủ multiplayer.

## Hình ảnh trong game

- Đội vàng ở bên trái và dùng các ảnh có tiền tố `yellow`; đội xanh ở bên phải và dùng các ảnh có tiền tố `green`.
- `tank` là xe tăng, `soldier` là lính, `energy` là từng đơn vị máu và `table` là lõi năng lượng.
- Lõi năng lượng nằm sát mép màn hình, phía sau xe tăng và lính.
- Khi bắt đầu trận, chiến trường chọn ngẫu nhiên một trong ba nền `assets/bg-1.jpg`, `assets/bg-2.jpg` và `assets/bg-3.jpg`. Trong phòng online, cả hai người chơi luôn nhận cùng một nền. `Play Again` giữ nguyên nền của trận vừa chơi.
- Các nút vật phẩm dùng đúng icon trong thư mục `assets`; Đạn phân 3 đang bay dùng màu riêng của đội sở hữu.
