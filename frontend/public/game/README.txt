Спрайты и подложки для игры (Taxi Runner)
==========================================

Положи сюда файлы (имена точно такие):

  Меню:
  menu_bg.png     — подложка фона меню игры (тёмная текстура)
  logo.png        — логотип под заголовком «Таксиранер»
  btn_primary.png — заготовка кнопки «Новая игра»
  btn_secondary.png — заготовка кнопки «Лидерборд»

  Игра:
  taxi.png, coin.png, obstacle.png
  obstacle_bus.png, obstacle_truck.png, obstacle_car_red.png, obstacle_car_blue.png
  road_edge_left.png, road_edge_right.png

Сгенерированные картинки лежат в:
  C:\Users\Данил\.cursor\projects\c-Users-Desktop-1\assets\

Меню (на белом фоне): menu_bg.png, logo.png, btn_primary.png, btn_secondary.png.
Спрайты для игры: taxi_sprite.png, coin_sprite.png (вид сверху, для такси и монетки).

Скопируй в frontend/public/game/. Для игры: taxi_sprite.png можно скопировать как taxi.png, coin_sprite.png как coin.png (игра подхватит их автоматически).

Если menu_bg.png нет — меню покажет градиент. Если спрайтов нет — игра рисует примитивами.
