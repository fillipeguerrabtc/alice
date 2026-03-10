import { 
  users, type User,
  conversations, type Conversation,
  messages, type Message,
  documents, type Document,
  namespaces, type Namespace,
  agents, type Agent,
} from "@alice/shared/schema";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";

type InsertConversation = typeof conversations.$inferInsert;
type InsertMessage = typeof messages.$inferInsert;
type InsertDocument = typeof documents.$inferInsert;

export interface UpsertUser {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getConversations(userId: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | undefined>;
  createConversation(data: InsertConversation): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  getMessages(conversationId: string, limit?: number): Promise<Message[]>;
  createMessage(data: InsertMessage): Promise<Message>;
  getDocuments(namespaceId?: string): Promise<Document[]>;
  createDocument(data: InsertDocument): Promise<Document>;
  deleteDocument(id: string): Promise<void>;
  getNamespaces(): Promise<Namespace[]>;
  getAgents(): Promise<Agent[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        id: userData.id,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        profileImageUrl: userData.profileImageUrl,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getConversations(userId: string): Promise<Conversation[]> {
    return db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.atualizadoEm));
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    return conversation;
  }

  async createConversation(data: InsertConversation): Promise<Conversation> {
    const [conversation] = await db
      .insert(conversations)
      .values(data)
      .returning();
    return conversation;
  }

  async deleteConversation(id: string): Promise<void> {
    await db.delete(conversations).where(eq(conversations.id, id));
  }

  async getMessages(conversationId: string, limit = 100): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.criadoEm)
      .limit(limit);
  }

  async createMessage(data: InsertMessage): Promise<Message> {
    const [message] = await db
      .insert(messages)
      .values(data)
      .returning();
    await db
      .update(conversations)
      .set({
        totalMensagens: sql`${conversations.totalMensagens} + 1`,
        ultimaMensagemEm: new Date(),
        atualizadoEm: new Date(),
      })
      .where(eq(conversations.id, data.conversationId));
    return message;
  }

  async getDocuments(namespaceId?: string): Promise<Document[]> {
    if (namespaceId) {
      return db
        .select()
        .from(documents)
        .where(eq(documents.namespaceId, namespaceId))
        .orderBy(desc(documents.criadoEm));
    }
    return db.select().from(documents).orderBy(desc(documents.criadoEm));
  }

  async createDocument(data: InsertDocument): Promise<Document> {
    const [document] = await db
      .insert(documents)
      .values(data)
      .returning();
    return document;
  }

  async deleteDocument(id: string): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  async getNamespaces(): Promise<Namespace[]> {
    return db.select().from(namespaces).orderBy(namespaces.ordem);
  }

  async getAgents(): Promise<Agent[]> {
    return db.select().from(agents).orderBy(agents.nome);
  }
}

export const storage = new DatabaseStorage();
