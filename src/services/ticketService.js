const { createTicket, getTicket, getTicketsByStatus,
    getTicketsByUserId, getTicketsByUserAndType, updateTicket, getUser,
    appendRecieptName
} = require('../models/reimbursmentModel');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../util/logger');
require('dotenv').config();

const { PutObjectCommand, GetObjectCommand, S3Client } = require("@aws-sdk/client-s3")
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");


const REGION = process.env.AWS_DEFAULT_REGION;
const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const s3 = new S3Client({ region: REGION });


async function submitTicket(ticket, userId) {


    try {
        const user = await getUser(userId);
        if (!user) {
            logger.warn(`User with ID ${userId} does not exist.`);
            return { success: false, error: "User does not exist." };
        };


        const ticketId = uuidv4();

        const ticketPayload = {
            ...ticket,
            ticket_id: ticketId,
            status: "Pending",
            PK: `USER#${userId}`,
            SK: `TICKET#${ticketId}`,
            receiptFileNames: [],
            createdAt: new Date().toISOString()
        };

        const createdTicket = await createTicket(ticketPayload);
        if (!createdTicket) {
            logger.warn("Failed to create ticket.");
            return { success: false, error: "Failed to create ticket." }
        }

        logger.info(`Ticket ${ticketId} created successfully for user ${userId}.`);

        const { PK, SK, ...ticketDetails } = createdTicket;

        return {
            success: true,
            ticket: ticketDetails
        };


    } catch (error) {
        logger.error(`Error during ticket submission for user ${userId}: ${error.message}`, error);
        return { success: false, error: "An unexpected error occurred during ticket submission." };
    };

}

async function getPendingTickets() {
    try {

        const tickets = await getTicketsByStatus("Pending");

        if (!tickets || tickets.length === 0) {
            logger.warn("No pending tickets found.");
            return { success: false, error: "No pending tickets available for processing." };
        }


        const signedTickets = await loadTicketsWithSignedUrls(tickets);


        logger.info(`${signedTickets.length} pending ticket(s) retrieved and processed.`);
        return { success: true, tickets: signedTickets };

    } catch (error) {
        logger.error(`Error retriecing tickets: ${error.message}`, error);
        return { success: false, error: "An unexpected error occurred during retrieving tickets." };
    }
};


async function processTicket(ticketId, userId, action) {
    try {

        let ticket = await getTicket(ticketId);

        if (!ticket || ticket.status !== "Pending") {
            logger.warn(`Cannot process ticket ${ticketId}. Status: ${ticket ? ticket.status : "Not Found"}`);
            return { success: false, error: "Ticket cannot be processed. Either it does not exist or it is already processed." };
        };
        if (ticket.userId == userId) {
            logger.warn(`Cannot process ticket ${ticketId}. Processing own ticket is not allowed`);
            return { success: false, error: "Ticket cannot be processed. Not allowed to process own ticket." };
        };
        const updatedTicket = {
            user_id: userId,
            ticket_id: ticketId,
            status: action
        };

        const response = await updateTicket(updatedTicket);

        if (!response) {
            logger.warn(`Failed to update ticket ${ticketId} status to ${action}.`);
            return {
                success: false,
                error: "Database error while updating ticket status."
            };
        };

        logger.info(`Ticket ${ticketId} processed successfully. Action: ${action}`);
        return { success: true, ticket: response };
    } catch (error) {
        logger.error(`Failed to process ticket ${ticketId}: ${error.message}`);
        return { success: false, error: "Failed to process ticket. Please try again later." };
    };
};


async function viewTicketsAsEmployee(userId, type) {
    try {

        const user = await getUser(userId);
        if (!user) {
            logger.warn(`User with ID ${userId} does not exist.`);
            return { success: false, error: "User does not exist." };
        };

        let tickets = null;
        if (type) {
            tickets = await getTicketsByUserAndType(userId, type);
        } else {
            tickets = await getTicketsByUserId(userId);
        };

        if (!tickets.length) {
            logger.warn(`No tickets found for user ID ${userId}.`);
            return { success: false, error: "No previous tickets found for the user." };
        };

        const signedTickets = await loadTicketsWithSignedUrls(tickets);


        logger.info(`${signedTickets.length} ticket(s) retrieved and processed for user ID ${userId}.`);
        return {
            success: true,
            tickets: signedTickets
        };

    } catch (error) {
        logger.error(`Error retrieving tickets for user ID ${user_id}: ${error.message}`, error);
        return { success: false, error: "An unexpected error occurred while retrieving tickets." };
    };
};


async function uploadReceipt(userId, ticketId, file) {
    try {
        const ticket = await getTicket(ticketId);

        if (!ticket || ticket.user_id !== userId) {
            logger.warn('Ticket not found or user ID does not match');
            return { success: false, error: { message: 'Ticket not found or user ID does not match' } }
        }


        const fileName = `${userId}/${ticketId}/${Date.now()}_${file.originalname}`;
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            key: fileName,
            Body: file.buffer,
            ContentType: file.mimeType
        });

        await s3.send(command);
        const newReciept = { fileName }
        const ticketPayload = {
            ticket_id: ticketId,
            receiptFileName: fileName,
            user_id: newReciept
        };
        const response = await appendRecieptName(ticketPayload);
        return { success: true, ticket: response }
    } catch (error) { }
    logger.error('Error uploading receipt', error);
    return { success: false, error: 'Error uploading receipt' };
};



async function loadTicketsWithSignedUrls(tickets) {
    try {

        const signedTickets = await Promise.all(tickets.map(async (ticket) => {
            if (Array.isArray(ticket.receiptFileName)) {
                ticket.receiptFileName = await Promise.all(ticket.receiptFileName.map(async (file) => {
                    if (file && file.fileName) {
                        const signedUrl = await getSignedUrl(
                            s3,
                            new GetObjectCommand({
                                Bucket: BUCKET_NAME,
                                Key: file.fileName
                            }),
                            { expiresIn: 3600 }
                        );
                        return { ...file, signedUrl };
                    }
                    return file;
                }));
            }
            return ticket;
        }));

        return signedTickets;


    } catch (error) {
        logger.error("Error generating signed URLs for tickets:", error);
        return { success: false, error: `Error generationg signed URL: ${error} ` };
    }
}



module.exports = {
    submitTicket,
    getPendingTickets,
    processTicket,
    viewTicketsAsEmployee,
    uploadReceipt
};