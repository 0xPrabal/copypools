'use client';

import { HelpCircle, Book, MessageCircle, FileText } from 'lucide-react';

export default function HelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Help & Support</h1>
        <p className="text-gray-400">Find answers and get support</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card card-hover cursor-pointer">
          <Book className="text-primary-400 mb-4" size={32} />
          <h3 className="text-lg font-semibold mb-2">Documentation</h3>
          <p className="text-gray-400 text-sm">
            Learn how to use CopyPools and manage your positions
          </p>
        </div>

        <div className="card card-hover cursor-pointer">
          <MessageCircle className="text-primary-400 mb-4" size={32} />
          <h3 className="text-lg font-semibold mb-2">Community</h3>
          <p className="text-gray-400 text-sm">
            Join our Discord community for help and discussions
          </p>
        </div>

        <div className="card card-hover cursor-pointer">
          <FileText className="text-primary-400 mb-4" size={32} />
          <h3 className="text-lg font-semibold mb-2">FAQs</h3>
          <p className="text-gray-400 text-sm">
            Common questions and answers about the platform
          </p>
        </div>

        <div className="card card-hover cursor-pointer">
          <HelpCircle className="text-primary-400 mb-4" size={32} />
          <h3 className="text-lg font-semibold mb-2">Contact Support</h3>
          <p className="text-gray-400 text-sm">
            Get in touch with our support team for assistance
          </p>
        </div>
      </div>
    </div>
  );
}
