import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Transaction } from './transaction.entity';

@Entity('positions')
export class Position {
  @PrimaryColumn({ type: 'varchar' })
  positionId: string;

  @Column({ type: 'varchar' })
  protocol: string;

  @Column({ type: 'varchar' })
  dexTokenId: string;

  @Column({ type: 'varchar' })
  owner: string;

  @Column({ type: 'varchar' })
  token0: string;

  @Column({ type: 'varchar' })
  token1: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'int', nullable: true })
  tickLower: number;

  @Column({ type: 'int', nullable: true })
  tickUpper: number;

  @Column({ type: 'varchar', nullable: true })
  liquidity: string;

  @Column({ type: 'varchar', nullable: true })
  lastCompoundTxHash: string;

  @Column({ type: 'timestamp', nullable: true })
  lastCompoundAt: Date;

  @Column({ type: 'int', default: 0 })
  compoundCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Transaction, (transaction) => transaction.position)
  transactions: Transaction[];
}
