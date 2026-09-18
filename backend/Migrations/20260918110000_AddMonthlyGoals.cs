using System;
using Invoice.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Invoice.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260918110000_AddMonthlyGoals")]
    public partial class AddMonthlyGoals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "monthly_goals",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Month = table.Column<int>(type: "integer", nullable: false),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: true),
                    Amount = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_monthly_goals", x => x.Id);
                    table.ForeignKey(
                        name: "FK_monthly_goals_categories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_monthly_goals_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_monthly_goals_CategoryId",
                table: "monthly_goals",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_monthly_goals_UserId_Year_Month",
                table: "monthly_goals",
                columns: new[] { "UserId", "Year", "Month" },
                unique: true,
                filter: "\"CategoryId\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_monthly_goals_UserId_Year_Month_CategoryId",
                table: "monthly_goals",
                columns: new[] { "UserId", "Year", "Month", "CategoryId" },
                unique: true,
                filter: "\"CategoryId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "monthly_goals");
        }
    }
}
