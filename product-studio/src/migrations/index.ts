import * as migration_20260808_155047_initial_product_studio from './20260808_155047_initial_product_studio';

export const migrations = [
  {
    up: migration_20260808_155047_initial_product_studio.up,
    down: migration_20260808_155047_initial_product_studio.down,
    name: '20260808_155047_initial_product_studio'
  },
];
