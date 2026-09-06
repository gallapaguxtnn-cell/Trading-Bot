import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPortfolios1788717394849 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "strategy_exchange_enum" ADD VALUE IF NOT EXISTS 'okx'
    `);
    await queryRunner.query(`
      ALTER TYPE "strategy_exchange_enum" ADD VALUE IF NOT EXISTS 'bingx'
    `);

    await queryRunner.query(`
      ALTER TABLE "strategy"
      ADD COLUMN "portfolioId" uuid
    `);

    await queryRunner.query(`
      CREATE TYPE "portfolio_exchange_enum" AS ENUM ('binance', 'bybit', 'okx', 'bingx')
    `);
    await queryRunner.query(`
      CREATE TYPE "portfolio_mode_enum" AS ENUM ('DEMO', 'REAL')
    `);

    await queryRunner.query(`
      CREATE TABLE "portfolio" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "exchange" "portfolio_exchange_enum" NOT NULL DEFAULT 'bybit',
        "mode" "portfolio_mode_enum" NOT NULL DEFAULT 'DEMO',
        "apiKey" text,
        "apiSecret" text,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_portfolio_id" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "portfolio"`);
    await queryRunner.query(`DROP TYPE "portfolio_mode_enum"`);
    await queryRunner.query(`DROP TYPE "portfolio_exchange_enum"`);
    await queryRunner.query(`ALTER TABLE "strategy" DROP COLUMN "portfolioId"`);
  }
}
