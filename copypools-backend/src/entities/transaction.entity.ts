import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Position } from './position.entity';

export enum TransactionType {
  OPEN_POSITION = 'OPEN_POSITION',
  CLOSE_POSITION = 'CLOSE_POSITION',
  MOVE_RANGE = 'MOVE_RANGE',
  COMPOUND = 'COMPOUND',
  ADD_LIQUIDITY = 'ADD_LIQUIDITY',
  REMOVE_LIQUIDITY = 'REMOVE_LIQUIDITY',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  positionId: string;

  @Column({
    type: 'enum',
    enum: TransactionType,
  })
  type: TransactionType;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ type: 'varchar', nullable: true })
  txHash: string;

  @Column({ type: 'int', nullable: true })
  blockNumber: number;

  @Column({ type: 'varchar', nullable: true })
  gasUsed: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Position, (position) => position.transactions)
  @JoinColumn({ name: 'positionId' })
  position: Position;
}
