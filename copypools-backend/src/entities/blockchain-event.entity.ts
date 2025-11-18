import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum EventType {
  POSITION_OPENED = 'POSITION_OPENED',
  POSITION_CLOSED = 'POSITION_CLOSED',
  RANGE_MOVED = 'RANGE_MOVED',
  LIQUIDITY_ADDED = 'LIQUIDITY_ADDED',
  LIQUIDITY_REMOVED = 'LIQUIDITY_REMOVED',
  FEES_COLLECTED = 'FEES_COLLECTED',
}

@Entity('blockchain_events')
@Index(['eventType', 'blockNumber'])
@Index(['positionId'])
export class BlockchainEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: EventType,
  })
  eventType: EventType;

  @Column({ type: 'varchar', nullable: true })
  positionId: string;

  @Column({ type: 'varchar' })
  txHash: string;

  @Column({ type: 'int' })
  blockNumber: number;

  @Column({ type: 'int' })
  logIndex: number;

  @Column({ type: 'jsonb' })
  eventData: any;

  @Column({ type: 'boolean', default: false })
  processed: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
