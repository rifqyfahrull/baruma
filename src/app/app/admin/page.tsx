"use client"

import { PageHeader } from "@/components/shared/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PlansTable } from "@/components/admin/plans-table"
import { TemplatesTable } from "@/components/admin/templates-table"
import { TransactionsTable } from "@/components/admin/transactions-table"
import { PaymentsTable } from "@/components/admin/payments-table"
import { UsersTable } from "@/components/admin/users-table"

export default function AdminPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Admin"
        description="Kelola paket harga, template, transaksi, dan pengguna."
      />

      <Tabs defaultValue="plans">
        <TabsList>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="transaksi">Transaksi</TabsTrigger>
          <TabsTrigger value="rekonsiliasi">Rekonsiliasi</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>
        <TabsContent value="plans" className="mt-4">
          <PlansTable />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <TemplatesTable />
        </TabsContent>
        <TabsContent value="transaksi" className="mt-4">
          <TransactionsTable />
        </TabsContent>
        <TabsContent value="rekonsiliasi" className="mt-4">
          <PaymentsTable />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UsersTable />
        </TabsContent>
      </Tabs>
    </div>
  )
}
